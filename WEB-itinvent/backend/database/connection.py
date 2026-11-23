"""
Database connection management with dynamic database switching support.
"""
import contextvars
import os
import queue
import threading
import time
from contextlib import contextmanager
from typing import Generator, Optional

import pyodbc

from backend.config import config


# A1: scoped SQL Server statement timeout. Set only by AI entry points (tool
# registry, action-card confirms) so driver-level query deadlines apply to the
# AI path while UI/API consumers keep the pyodbc default (unlimited).
ai_sql_query_timeout: contextvars.ContextVar[Optional[float]] = contextvars.ContextVar(
    "ai_sql_query_timeout", default=None
)


@contextmanager
def sql_query_timeout_scope(seconds: Optional[float]) -> Generator[None, None, None]:
    """Apply the scoped statement timeout for the duration of the block."""
    if seconds is None:
        yield
        return
    token = ai_sql_query_timeout.set(seconds)
    try:
        yield
    finally:
        ai_sql_query_timeout.reset(token)


class SqlStatementTimeoutUnsupportedError(RuntimeError):
    """A1 (P0-2): raised BEFORE any SQL runs when an AI-scoped statement
    timeout was requested but the driver refused it — fail closed instead
    of executing unbounded."""


def get_database_config(db_id: Optional[str] = None) -> dict:
    """
    Get database configuration by ID.
    If db_id is None, returns default configuration from config.

    Args:
        db_id: Database ID (e.g., "ITINVENT", "MSK-ITINVENT", "OBJ-ITINVENT", "SPB-ITINVENT")

    Returns:
        Dictionary with host, database, username, password, driver
    """
    if not db_id or db_id == config.database.database:
        return {
            "host": config.database.host,
            "database": config.database.database,
            "username": config.database.username,
            "password": config.database.password,
            "driver": config.database.driver,
            "encrypt": config.database.encrypt,
            "trust_server_certificate": config.database.trust_server_certificate,
        }

    # Get config for specific database from environment
    env_prefix = f"DB_{db_id}_"
    trust_raw = str(os.getenv(f"{env_prefix}TRUST_SERVER_CERTIFICATE", "") or "").strip().lower()
    trust_server_certificate = config.database.trust_server_certificate
    if trust_raw:
        trust_server_certificate = trust_raw in {"1", "true", "yes", "on"}
    db_config = {
        "host": os.getenv(f"{env_prefix}HOST", config.database.host),
        "database": os.getenv(f"{env_prefix}DATABASE", db_id),
        "username": os.getenv(f"{env_prefix}USERNAME", "ROUser"),
        "password": os.getenv(f"{env_prefix}PASSWORD", ""),
        "driver": config.database.driver,
        "encrypt": str(os.getenv(f"{env_prefix}ENCRYPT", config.database.encrypt) or "yes").strip() or "yes",
        "trust_server_certificate": trust_server_certificate,
    }
    config.validate_sql_server_tls(
        encrypt=db_config["encrypt"],
        trust_server_certificate=db_config["trust_server_certificate"],
        encrypt_var=f"{env_prefix}ENCRYPT",
        trust_var=f"{env_prefix}TRUST_SERVER_CERTIFICATE",
    )
    return db_config


def build_connection_string(db_config: dict) -> str:
    """Build ODBC connection string from database config."""
    return (
        f"DRIVER={db_config['driver']};"
        f"SERVER={db_config['host']};"
        f"DATABASE={db_config['database']};"
        f"UID={db_config['username']};"
        f"PWD={db_config['password']};"
        f"Encrypt={str(db_config.get('encrypt') or 'yes').strip() or 'yes'};"
        f"TrustServerCertificate={'yes' if db_config.get('trust_server_certificate') else 'no'};"
        "autocommit=True;"
    )


def configure_pyodbc_encoding(conn: pyodbc.Connection) -> None:
    """
    Configure pyodbc string codecs for SQL Server (ITINVENT legacy).

    - VARCHAR/CHAR: Windows-1251 (Cyrillic in legacy ITINVENT schemas).
    - NVARCHAR/NCHAR: UTF-16-LE (SQL Server wide-character wire format).
      Using UTF-8 for SQL_WCHAR causes UnicodeDecodeError on fetch (e.g. 0xE3/0xC4).
    Override via env when a database uses another charset.
    """
    sql_char_encoding = os.getenv("SQL_CHAR_ENCODING", "cp1251")
    sql_wchar_encoding = os.getenv("SQL_WCHAR_ENCODING", "utf-16-le")

    conn.setdecoding(pyodbc.SQL_CHAR, encoding=sql_char_encoding)
    conn.setdecoding(pyodbc.SQL_WCHAR, encoding=sql_wchar_encoding)
    conn.setencoding(encoding=sql_wchar_encoding)
    conn.setencoding(encoding=sql_char_encoding, ctype=pyodbc.SQL_CHAR)


def _env_pool_size(default: int = 10) -> int:
    raw = str(os.getenv("SQL_SERVER_POOL_SIZE", str(default)) or "").strip()
    try:
        return max(1, min(32, int(raw)))
    except (TypeError, ValueError):
        return default


def _env_pool_idle_ping_sec(default: float = 30.0) -> float:
    """Seconds a pooled connection may sit idle before it needs a SELECT 1 ping."""
    raw = str(os.getenv("SQL_SERVER_POOL_IDLE_PING_SEC", str(default)) or "").strip()
    try:
        return max(0.0, min(600.0, float(raw)))
    except (TypeError, ValueError):
        return default


class _PyodbcConnectionPool:
    """Pool of (conn, released_at) entries — SELECT 1 only for idle connections."""

    def __init__(self, connection_string: str, *, pool_size: int, idle_ping_sec: float = 30.0) -> None:
        self._connection_string = connection_string
        self._pool_size = max(1, int(pool_size))
        self._idle_ping_sec = max(0.0, float(idle_ping_sec))
        self._pool: queue.Queue[tuple[pyodbc.Connection, float]] = queue.Queue(maxsize=self._pool_size)
        self._created = 0
        self._lock = threading.Lock()

    def _create_connection(self) -> pyodbc.Connection:
        conn = pyodbc.connect(self._connection_string, timeout=30)
        conn.autocommit = False
        configure_pyodbc_encoding(conn)
        return conn

    def _abandon(self, conn: pyodbc.Connection) -> None:
        """Close + drop a conn from pool accounting (broken or unverifiable)."""
        try:
            conn.close()
        except Exception:
            pass
        with self._lock:
            self._created = max(0, self._created - 1)

    def _ping(self, conn: pyodbc.Connection, *, ping_timeout: Optional[float]) -> None:
        """SELECT 1 health check. When ``ping_timeout`` is requested (AI path)
        the driver timeout covers the ping itself — fail closed on refusal,
        verify the restore, never run an unbounded statement."""
        if ping_timeout is None:
            cursor = conn.cursor()
            try:
                cursor.execute("SELECT 1")
            finally:
                cursor.close()
            return
        try:
            prev_timeout = conn.timeout
            conn.timeout = int(ping_timeout)
            if conn.timeout != int(ping_timeout):
                raise RuntimeError("driver ignored statement timeout")
        except Exception as exc:
            self._abandon(conn)
            raise SqlStatementTimeoutUnsupportedError(
                "SQL driver rejected the ping timeout — соединение выброшено, "
                "запрос не выполнялся."
            ) from exc
        try:
            cursor = conn.cursor()
            try:
                cursor.execute("SELECT 1")
            finally:
                cursor.close()
        finally:
            try:
                conn.timeout = prev_timeout
                if conn.timeout != prev_timeout:
                    raise RuntimeError("ping timeout restore not reflected")
            except Exception:
                # Conn state unknown — let acquire's generic handler abandon
                # it and continue with the next pooled connection.
                raise

    def acquire(self, *, ping_timeout: Optional[float] = None) -> pyodbc.Connection:
        try:
            conn, released_at = self._pool.get_nowait()
            try:
                # Ping only when the connection sat idle long enough to risk a
                # server-side/network timeout — a fresh borrow needs no SELECT 1.
                if time.monotonic() - released_at > self._idle_ping_sec:
                    self._ping(conn, ping_timeout=ping_timeout)
                return conn
            except SqlStatementTimeoutUnsupportedError:
                raise  # fail-closed: do NOT fall through to another connection
            except Exception:
                self._abandon(conn)
        except queue.Empty:
            pass

        should_create = False
        with self._lock:
            if self._created < self._pool_size:
                self._created += 1
                should_create = True

        if should_create:
            try:
                return self._create_connection()
            except Exception:
                with self._lock:
                    self._created = max(0, self._created - 1)
                raise

        conn, _released_at = self._pool.get(timeout=30)
        return conn

    def discard(self, conn: pyodbc.Connection) -> None:
        """Drop a connection that is not known to be usable (failed rollback/disconnect)."""
        try:
            conn.close()
        except Exception:
            pass
        with self._lock:
            self._created = max(0, self._created - 1)

    def release(self, conn: pyodbc.Connection) -> None:
        try:
            self._pool.put_nowait((conn, time.monotonic()))
        except queue.Full:
            try:
                conn.close()
            except Exception:
                pass
            with self._lock:
                self._created = max(0, self._created - 1)


_POOLS: dict[str, _PyodbcConnectionPool] = {}
_POOLS_LOCK = threading.Lock()


def _get_connection_pool(connection_string: str) -> _PyodbcConnectionPool:
    with _POOLS_LOCK:
        pool = _POOLS.get(connection_string)
        if pool is None:
            pool = _PyodbcConnectionPool(
                connection_string,
                pool_size=_env_pool_size(),
                idle_ping_sec=_env_pool_idle_ping_sec(),
            )
            _POOLS[connection_string] = pool
        return pool


class DatabaseConnectionManager:
    """Manager for SQL Server database connections with dynamic switching."""

    def __init__(self, db_id: Optional[str] = None, *, query_timeout: Optional[float] = None):
        """
        Initialize database manager.

        Args:
            db_id: Database ID to use (None for default)
            query_timeout: Optional pyodbc statement timeout (seconds) applied
                to every connection checkout from this manager. The previous
                value is restored before the connection returns to the pool.
        """
        self._pool_size = _env_pool_size()
        self._db_id = db_id
        self._query_timeout = query_timeout
        self._db_config = get_database_config(db_id)
        self._connection_string = build_connection_string(self._db_config)
        self._pool = _get_connection_pool(self._connection_string)

    def get_current_database(self) -> str:
        """Get current database ID."""
        return self._db_id or self._db_config["database"]

    @contextmanager
    def get_connection(self) -> Generator[pyodbc.Connection, None, None]:
        """
        Get a database connection from the pool.

        Usage:
            with db_manager.get_connection() as conn:
                cursor = conn.cursor()
                cursor.execute("SELECT * FROM ITEMS")
        """
        conn = None
        broken = False
        prev_timeout: Optional[float] = None
        timeout_override = getattr(self, "_query_timeout", None)
        if timeout_override is None:
            timeout_override = ai_sql_query_timeout.get()
        try:
            # P0 (cycle 3): the AI-scoped timeout covers the idle SELECT 1
            # ping inside acquire — it must not run unbounded either.
            conn = self._pool.acquire(ping_timeout=timeout_override)
            if timeout_override is not None:
                # A1/P0-2 fail-closed: when a timeout was requested we must be
                # sure the driver actually accepted it — abort before any SQL
                # runs and discard the connection instead of executing
                # unbounded. Non-AI callers (timeout_override is None) are
                # untouched: they never reach this branch.
                try:
                    prev_timeout = conn.timeout
                    conn.timeout = int(timeout_override)
                    if conn.timeout != int(timeout_override):
                        raise RuntimeError("driver ignored statement timeout")
                except Exception as exc:
                    broken = True
                    raise SqlStatementTimeoutUnsupportedError(
                        "SQL driver rejected the statement timeout "
                        f"({timeout_override}s) — запрос отменён до выполнения."
                    ) from exc
            yield conn
            conn.commit()
        except Exception:
            if conn:
                try:
                    conn.rollback()
                except Exception:
                    # A connection that cannot roll back is in an unknown state: never pool it,
                    # and keep the original error as the cause the caller sees (DOPS-02).
                    broken = True
            raise
        finally:
            if conn:
                if prev_timeout is not None:
                    try:
                        conn.timeout = prev_timeout
                        if conn.timeout != prev_timeout:
                            raise RuntimeError("timeout restore not reflected")
                    except Exception:
                        # The connection is in an unknown state — never return
                        # it to the pool carrying a mutated timeout.
                        broken = True
                if broken:
                    self._pool.discard(conn)
                else:
                    self._pool.release(conn)

    def test_connection(self) -> bool:
        """Test if database connection is working."""
        try:
            with self.get_connection() as conn:
                cursor = conn.cursor()
                cursor.execute("SELECT 1")
                return True
        except Exception as e:
            print(f"Database connection error: {e}")
            return False

    def execute_query(self, query: str, params: Optional[tuple] = None) -> list[dict]:
        """
        Execute a SELECT query and return results as list of dicts.

        Args:
            query: SQL query with ? placeholders
            params: Tuple of parameters for query

        Returns:
            List of dictionaries with column names as keys
        """
        with self.get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute(query, params or ())

            # Get column names from cursor.description
            columns = [column[0] for column in cursor.description] if cursor.description else []

            # Convert rows to dictionaries
            results = []
            for row in cursor:
                results.append(dict(zip(columns, row)))

            return results

    def execute_update(self, query: str, params: Optional[tuple] = None) -> int:
        """
        Execute an INSERT/UPDATE/DELETE query.

        Args:
            query: SQL query with ? placeholders
            params: Tuple of parameters for query

        Returns:
            Number of affected rows
        """
        with self.get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute(query, params or ())
            return cursor.rowcount


# Global default connection manager instance
db_manager = DatabaseConnectionManager()


def get_db(db_id: Optional[str] = None, *, query_timeout: Optional[float] = None) -> DatabaseConnectionManager:
    """
    Dependency function for FastAPI to get database manager.

    Args:
        db_id: Database ID to use (None for default)
        query_timeout: Optional pyodbc statement timeout (seconds) for every
            checkout of the returned manager

    Returns:
        DatabaseConnectionManager instance
    """
    return DatabaseConnectionManager(db_id, query_timeout=query_timeout)


# User database selection (in-memory for session)
_user_databases: dict[str, str] = {}


def _build_user_key(user_id: Optional[int] = None, username: Optional[str] = None) -> Optional[str]:
    """
    Build a stable key for user-scoped storage.

    Priority:
    1. Non-zero numeric user_id
    2. Username (lowercase)
    """
    if user_id not in (None, 0):
        return f"id:{int(user_id)}"
    if username:
        normalized = str(username).strip().lower()
        if normalized:
            return f"user:{normalized}"
    return None


def set_user_database(user_id: Optional[int], db_id: str, username: Optional[str] = None) -> None:
    """Set selected database for a user (by id or username)."""
    key = _build_user_key(user_id, username)
    if not key:
        return
    _user_databases[key] = db_id


def get_user_database(user_id: Optional[int], username: Optional[str] = None) -> Optional[str]:
    """Get selected database for a user (by id or username)."""
    # Try strict id key first, then username key fallback.
    id_key = _build_user_key(user_id, None)
    if id_key and id_key in _user_databases:
        return _user_databases[id_key]

    user_key = _build_user_key(None, username)
    if user_key and user_key in _user_databases:
        return _user_databases[user_key]

    return None


def clear_user_database(user_id: Optional[int], username: Optional[str] = None) -> None:
    """Clear database selection for a user."""
    id_key = _build_user_key(user_id, None)
    user_key = _build_user_key(None, username)
    if id_key:
        _user_databases.pop(id_key, None)
    if user_key:
        _user_databases.pop(user_key, None)
