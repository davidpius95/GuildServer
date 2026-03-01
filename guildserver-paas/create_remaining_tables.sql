-- Create remaining essential enums
CREATE TYPE IF NOT EXISTS source_type AS ENUM('github', 'gitlab', 'bitbucket', 'gitea', 'docker', 'git', 'drop');
CREATE TYPE IF NOT EXISTS build_type AS ENUM('dockerfile', 'nixpacks', 'heroku', 'paketo', 'static', 'railpack');
CREATE TYPE IF NOT EXISTS approval_status AS ENUM('pending', 'approved', 'rejected', 'expired');
CREATE TYPE IF NOT EXISTS cluster_status AS ENUM('active', 'inactive', 'error', 'pending', 'maintenance');
CREATE TYPE IF NOT EXISTS execution_status AS ENUM('pending', 'running', 'paused', 'completed', 'failed', 'cancelled');
CREATE TYPE IF NOT EXISTS sso_provider_type AS ENUM('saml', 'oidc', 'ldap', 'azure-ad', 'google', 'github');
CREATE TYPE IF NOT EXISTS workflow_status AS ENUM('draft', 'active', 'inactive', 'archived');

-- Create projects table
CREATE TABLE IF NOT EXISTS projects (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name varchar(255) NOT NULL,
    description text,
    icon text,
    color varchar(7) DEFAULT '#3b82f6',
    organization_id uuid REFERENCES organizations(id) ON DELETE CASCADE,
    created_at timestamp DEFAULT now(),
    updated_at timestamp DEFAULT now()
);

-- Create applications table
CREATE TABLE IF NOT EXISTS applications (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name varchar(255) NOT NULL,
    app_name varchar(255) NOT NULL,
    description text,
    project_id uuid REFERENCES projects(id) ON DELETE CASCADE,
    source_type source_type,
    repository text,
    branch varchar(255) DEFAULT 'main',
    build_path text,
    dockerfile text,
    build_type build_type,
    build_args jsonb DEFAULT '{}',
    environment jsonb DEFAULT '{}',
    docker_image text,
    docker_tag varchar(255) DEFAULT 'latest',
    memory_reservation integer,
    memory_limit integer,
    cpu_reservation numeric,
    cpu_limit numeric,
    replicas integer DEFAULT 1,
    auto_deployment boolean DEFAULT false,
    preview_deployments boolean DEFAULT false,
    status varchar(50) DEFAULT 'inactive',
    created_at timestamp DEFAULT now(),
    updated_at timestamp DEFAULT now()
);

-- Create databases table
CREATE TABLE IF NOT EXISTS databases (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name varchar(255) NOT NULL,
    type varchar(50) NOT NULL,
    project_id uuid REFERENCES projects(id) ON DELETE CASCADE,
    database_name varchar(255) NOT NULL,
    username varchar(255) NOT NULL,
    password text NOT NULL,
    docker_image text,
    command text,
    environment jsonb DEFAULT '{}',
    memory_limit integer,
    cpu_limit numeric,
    external_port integer,
    status varchar(50) DEFAULT 'inactive',
    created_at timestamp DEFAULT now(),
    updated_at timestamp DEFAULT now()
);

-- Create deployments table
CREATE TABLE IF NOT EXISTS deployments (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    title varchar(255),
    description text,
    status varchar(50) DEFAULT 'pending',
    application_id uuid REFERENCES applications(id) ON DELETE CASCADE,
    database_id uuid REFERENCES databases(id) ON DELETE CASCADE,
    git_commit_sha varchar(255),
    build_logs text,
    deployment_logs text,
    started_at timestamp,
    completed_at timestamp,
    created_at timestamp DEFAULT now()
);

-- Create audit_logs table
CREATE TABLE IF NOT EXISTS audit_logs (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid REFERENCES users(id),
    organization_id uuid REFERENCES organizations(id) ON DELETE CASCADE,
    action varchar(100) NOT NULL,
    resource_type varchar(100) NOT NULL,
    resource_id uuid,
    resource_name varchar(255),
    metadata jsonb DEFAULT '{}',
    ip_address inet,
    user_agent text,
    timestamp timestamp DEFAULT now(),
    session_id varchar(255)
);

-- Create metrics table
CREATE TABLE IF NOT EXISTS metrics (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    application_id uuid REFERENCES applications(id) ON DELETE CASCADE,
    organization_id uuid REFERENCES organizations(id) ON DELETE CASCADE,
    metric_name varchar(100) NOT NULL,
    metric_value numeric NOT NULL,
    unit varchar(20),
    tags jsonb DEFAULT '{}',
    timestamp timestamp DEFAULT now(),
    created_at timestamp DEFAULT now()
);