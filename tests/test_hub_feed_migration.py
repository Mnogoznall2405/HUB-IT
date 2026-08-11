from pathlib import Path

from alembic import command
from alembic.config import Config
import sqlalchemy as sa


PROJECT_ROOT = Path(__file__).resolve().parents[1]
WEB_ROOT = PROJECT_ROOT / "WEB-itinvent"


def test_feed_vk_migration_upgrades_existing_publications(tmp_path):
    database_path = tmp_path / "feed-before-0089.db"
    database_url = f"sqlite:///{database_path.as_posix()}"
    engine = sa.create_engine(database_url)
    with engine.begin() as connection:
        connection.exec_driver_sql("CREATE TABLE alembic_version (version_num VARCHAR(32) NOT NULL)")
        connection.exec_driver_sql("INSERT INTO alembic_version (version_num) VALUES ('20260806_0088')")
        connection.exec_driver_sql(
            """CREATE TABLE hub_announcements (
                id TEXT PRIMARY KEY, is_active INTEGER NOT NULL,
                published_from TEXT, published_at TEXT, updated_at TEXT
            )"""
        )
        connection.exec_driver_sql(
            """CREATE TABLE hub_announcement_attachments (
                id TEXT PRIMARY KEY, announcement_id TEXT NOT NULL,
                uploaded_at TEXT NOT NULL, file_mime TEXT
            )"""
        )
        connection.exec_driver_sql(
            """CREATE TABLE hub_announcement_comments (
                id TEXT PRIMARY KEY, announcement_id TEXT NOT NULL, created_at TEXT NOT NULL
            )"""
        )
        connection.exec_driver_sql(
            """CREATE TABLE hub_announcement_likes (
                announcement_id TEXT NOT NULL, user_id INTEGER NOT NULL,
                username TEXT NOT NULL, full_name TEXT NOT NULL, created_at TEXT NOT NULL,
                PRIMARY KEY (announcement_id, user_id)
            )"""
        )
        connection.exec_driver_sql(
            "INSERT INTO hub_announcements VALUES ('published', 1, NULL, '2026-08-01', '2026-08-01')"
        )
        connection.exec_driver_sql(
            "INSERT INTO hub_announcements VALUES ('archived', 0, NULL, '2026-08-01', '2026-08-01')"
        )
        connection.exec_driver_sql(
            "INSERT INTO hub_announcement_likes VALUES ('published', 7, 'user7', 'User Seven', '2026-08-02')"
        )

    config = Config(str(WEB_ROOT / "backend" / "alembic.ini"))
    config.set_main_option("script_location", str(WEB_ROOT / "backend" / "alembic"))
    config.set_main_option("sqlalchemy.url", database_url)
    config.attributes["configure_logger"] = False
    config.attributes["itinvent_scope"] = "app"
    command.upgrade(config, "head")

    inspector = sa.inspect(engine)
    announcement_columns = {item["name"] for item in inspector.get_columns("hub_announcements")}
    assert {"status", "comments_enabled", "reactions_enabled", "publication_notified_at", "category_id"} <= announcement_columns
    assert inspector.has_table("hub_announcement_comment_reactions")
    assert inspector.has_table("hub_announcement_categories")
    assert inspector.has_table("hub_announcement_bookmarks")
    assert inspector.has_table("hub_announcement_polls")
    assert inspector.has_table("hub_announcement_poll_options")
    assert inspector.has_table("hub_announcement_poll_votes")
    with engine.connect() as connection:
        statuses = {
            str(row.id): str(row.status)
            for row in connection.execute(sa.text("SELECT id, status FROM hub_announcements"))
        }
        reaction = connection.execute(
            sa.text("SELECT reaction_type FROM hub_announcement_reactions WHERE announcement_id = 'published' AND user_id = 7")
        ).scalar_one()
        revision = connection.execute(sa.text("SELECT version_num FROM alembic_version")).scalar_one()
    assert statuses == {"published": "published", "archived": "archived"}
    assert reaction == "like"
    assert revision == "20260807_0090"
