<#
.SYNOPSIS
Sets up Argonaut's database on a PostgreSQL server you already run, without Docker.

.DESCRIPTION
Creates the login role and the database (create-role-and-database.sql), then loads the whole
schema (schema.sql) into it as that role. Needs psql, which comes with PostgreSQL: on PATH, or
given with -Psql. psql asks for the admin password itself unless PGPASSWORD is set.

With Docker you don't need this: the argonaut-db container makes the database, and the API
builds the schema on its first start (see scripts\install.ps1).

.EXAMPLE
.\database\install-database.ps1 -AdminUser postgres -WithStarterTasks
#>
param(
    [string]$DbHost = 'localhost',
    [int]$Port = 5432,
    [string]$AdminUser = 'postgres',
    [string]$Database = 'argonaut',
    [string]$AppUser = 'argonaut',
    [securestring]$AppPassword,
    # Also add three example tasks to the Missions tab (server\seeds\starter-tasks.sql).
    [switch]$WithStarterTasks,
    [string]$Psql = 'psql'
)

$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent

if (-not (Get-Command $Psql -ErrorAction SilentlyContinue)) {
    throw "psql wasn't found. Install PostgreSQL's command-line tools, or pass its path with -Psql."
}
if ($Database -notmatch '^[a-z_][a-z0-9_]*$' -or $AppUser -notmatch '^[a-z_][a-z0-9_]*$') {
    throw 'Use lowercase letters, digits and underscores for -Database and -AppUser.'
}
if (-not $AppPassword) {
    $AppPassword = Read-Host "Password for the new '$AppUser' role" -AsSecureString
}
$plain = [Runtime.InteropServices.Marshal]::PtrToStringBSTR(
    [Runtime.InteropServices.Marshal]::SecureStringToBSTR($AppPassword))
if ($plain.Length -lt 8) { throw 'Choose a password of at least 8 characters.' }

function Invoke-Psql([string]$user, [string]$database, [string[]]$arguments) {
    & $Psql -h $DbHost -p $Port -U $user -d $database -v ON_ERROR_STOP=1 -q @arguments
    if ($LASTEXITCODE -ne 0) { throw "psql failed (as $user on $database)" }
}

Write-Host "Creating the role '$AppUser' and the database '$Database' on ${DbHost}:$Port"
Invoke-Psql $AdminUser 'postgres' @(
    '-v', "app_user=$AppUser", '-v', "app_db=$Database", '-v', "app_password=$plain",
    '-f', (Join-Path $PSScriptRoot 'create-role-and-database.sql'))

# The rest runs as the app's own role, so it owns every table it creates.
$previous = $env:PGPASSWORD
$env:PGPASSWORD = $plain
try {
    $existing = & $Psql -h $DbHost -p $Port -U $AppUser -d $Database -tAc "SELECT to_regclass('public.schema_migrations') IS NOT NULL"
    if ($LASTEXITCODE -ne 0) { throw "Couldn't sign in as '$AppUser'. If the role already existed, use its password." }
    if ($existing.Trim() -eq 't') {
        Write-Host "The database already has Argonaut's schema; the API brings it up to date when it starts."
    }
    else {
        Write-Host 'Loading the schema'
        Invoke-Psql $AppUser $Database @('-f', (Join-Path $PSScriptRoot 'schema.sql')) | Out-Null
    }
    if ($WithStarterTasks) {
        Write-Host 'Adding the starter tasks'
        Invoke-Psql $AppUser $Database @('-f', (Join-Path $root 'server\seeds\starter-tasks.sql'))
    }
}
finally {
    $env:PGPASSWORD = $previous
}

Write-Host ''
Write-Host 'Done. Point the API at it with:'
Write-Host "  PGHOST=$DbHost PGPORT=$Port PGDATABASE=$Database PGUSER=$AppUser PGPASSWORD=<the password>"
