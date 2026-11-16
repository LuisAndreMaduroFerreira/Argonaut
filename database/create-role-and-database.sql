-- Creates Argonaut's login role and its database on an existing PostgreSQL 16 (or newer)
-- server. Run it as a superuser with psql, passing the names and the password as variables:
--
--   psql -h localhost -U postgres -d postgres -v ON_ERROR_STOP=1 \
--        -v app_user=argonaut -v app_db=argonaut -v app_password='a long secret' \
--        -f database/create-role-and-database.sql
--
-- Then load schema.sql into the new database as app_user (install-database.ps1 does both).
-- Running it again changes nothing: an existing role or database is left as it is.

SELECT format('CREATE ROLE %I LOGIN PASSWORD %L', :'app_user', :'app_password')
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = :'app_user')
\gexec

-- The role owns the database, and with it the public schema, so it can create the tables.
SELECT format('CREATE DATABASE %I OWNER %I ENCODING ''UTF8'' TEMPLATE template0', :'app_db', :'app_user')
WHERE NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = :'app_db')
\gexec

SELECT format('REVOKE ALL ON DATABASE %I FROM PUBLIC', :'app_db')
\gexec
