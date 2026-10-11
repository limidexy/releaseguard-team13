-- Each business service has its own database and least-privilege login.
-- Passwords come from psql variables injected by init.sh, never from this file.
CREATE USER rg_registry WITH PASSWORD :'registry_password';
CREATE USER rg_evaluation WITH PASSWORD :'evaluation_password';
CREATE USER rg_governance WITH PASSWORD :'governance_password';
CREATE DATABASE rg_registry OWNER rg_registry;
CREATE DATABASE rg_evaluation OWNER rg_evaluation;
CREATE DATABASE rg_governance OWNER rg_governance;
REVOKE CONNECT ON DATABASE rg_registry FROM PUBLIC;
REVOKE CONNECT ON DATABASE rg_evaluation FROM PUBLIC;
REVOKE CONNECT ON DATABASE rg_governance FROM PUBLIC;
GRANT CONNECT ON DATABASE rg_registry TO rg_registry;
GRANT CONNECT ON DATABASE rg_evaluation TO rg_evaluation;
GRANT CONNECT ON DATABASE rg_governance TO rg_governance;
