-- Create basic enums
CREATE TYPE user_role AS ENUM('admin', 'user');
CREATE TYPE member_role AS ENUM('owner', 'admin', 'member');

-- Create users table
CREATE TABLE IF NOT EXISTS users (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    email varchar(255) UNIQUE NOT NULL,
    name varchar(255),
    password text,
    avatar text,
    role user_role DEFAULT 'user',
    email_verified timestamp,
    two_factor_secret text,
    two_factor_enabled boolean DEFAULT false,
    last_login timestamp,
    preferences jsonb DEFAULT '{}',
    created_at timestamp DEFAULT now(),
    updated_at timestamp DEFAULT now()
);

-- Create organizations table
CREATE TABLE IF NOT EXISTS organizations (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name varchar(255) NOT NULL,
    slug varchar(255) UNIQUE NOT NULL,
    logo text,
    description text,
    metadata jsonb DEFAULT '{}',
    owner_id uuid NOT NULL,
    created_at timestamp DEFAULT now(),
    updated_at timestamp DEFAULT now()
);

-- Create members table
CREATE TABLE IF NOT EXISTS members (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid REFERENCES users(id) ON DELETE CASCADE,
    organization_id uuid REFERENCES organizations(id) ON DELETE CASCADE,
    role member_role NOT NULL,
    permissions jsonb DEFAULT '{}',
    projects_access text[] DEFAULT '{}',
    applications_access text[] DEFAULT '{}',
    joined_at timestamp DEFAULT now(),
    updated_at timestamp DEFAULT now()
);