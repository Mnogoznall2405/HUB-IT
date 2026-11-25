import sqlite3
import sys

table = sys.argv[1] if len(sys.argv) > 1 else "my_files"
db = sqlite3.connect("e2e/stack/.state-v3/app.sqlite3")
for name, notnull, dflt in db.execute(
        "select name, \"notnull\", dflt_value from pragma_table_info('%s')" % table):
    print(("NN " if notnull else "   ") + name + ("  default=" + str(dflt) if dflt is not None else ""))
