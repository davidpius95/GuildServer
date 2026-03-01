-- Dokploy Enterprise Edition - Database Schema Extensions
-- This file contains the additional schema elements needed for enterprise features
-- Add these to the existing Dokploy database schema

-- =======================
-- KUBERNETES MANAGEMENT
-- =======================

-- Enum types for Kubernetes
CREATE TYPE cluster_status_enum AS ENUM ('active', 'inactive', 'error', 'pending', 'maintenance');
CREATE TYPE k8s_deployment_status_enum AS ENUM ('pending', 'running', 'succeeded', 'failed', 'unknown');
CREATE TYPE node_status_enum AS ENUM ('ready', 'not-ready', 'unknown');

-- Kubernetes clusters
CREATE TABLE kubernetes_clusters (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL,
    kubeconfig TEXT NOT NULL,
    endpoint TEXT NOT NULL,
    version VARCHAR(50),
    provider VARCHAR(100), -- aws, gcp, azure, on-premise
    region VARCHAR(100),
    status cluster_status_enum DEFAULT 'pending',
    metadata JSONB DEFAULT '{}',
    organization_id UUID REFERENCES organization(id) ON DELETE CASCADE,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- Kubernetes deployments
CREATE TABLE k8s_deployments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL,
    namespace VARCHAR(255) DEFAULT 'default',
    cluster_id UUID REFERENCES kubernetes_clusters(id) ON DELETE CASCADE,
    application_id UUID REFERENCES application(id) ON DELETE CASCADE,
    helm_chart_name VARCHAR(255),
    helm_chart_version VARCHAR(50),
    values JSONB DEFAULT '{}',
    status k8s_deployment_status_enum DEFAULT 'pending',
    replicas INTEGER DEFAULT 1,
    ready_replicas INTEGER DEFAULT 0,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- Resource quotas
CREATE TABLE resource_quotas (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL,
    namespace VARCHAR(255) NOT NULL,
    cluster_id UUID REFERENCES kubernetes_clusters(id) ON DELETE CASCADE,
    cpu_limit VARCHAR(50),
    memory_limit VARCHAR(50),
    storage_limit VARCHAR(50),
    pod_limit INTEGER,
    organization_id UUID REFERENCES organization(id) ON DELETE CASCADE,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- =======================
-- ENTERPRISE AUTHENTICATION
-- =======================

-- SSO providers
CREATE TYPE sso_provider_type_enum AS ENUM ('saml', 'oidc', 'ldap', 'azure-ad', 'google', 'github');

CREATE TABLE sso_providers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL,
    provider_type sso_provider_type_enum NOT NULL,
    configuration JSONB NOT NULL,
    organization_id UUID REFERENCES organization(id) ON DELETE CASCADE,
    enabled BOOLEAN DEFAULT true,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- Enhanced roles with conditions
CREATE TABLE enterprise_roles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL,
    description TEXT,
    organization_id UUID REFERENCES organization(id) ON DELETE CASCADE,
    permissions JSONB NOT NULL DEFAULT '{}',
    conditions JSONB DEFAULT '{}',
    is_system_role BOOLEAN DEFAULT false,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),
    UNIQUE(organization_id, name)
);

-- Access policies
CREATE TYPE policy_type_enum AS ENUM ('rbac', 'abac', 'resource-based', 'time-based');

CREATE TABLE access_policies (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL,
    description TEXT,
    type policy_type_enum NOT NULL,
    rules JSONB NOT NULL,
    organization_id UUID REFERENCES organization(id) ON DELETE CASCADE,
    active BOOLEAN DEFAULT true,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- =======================
-- SECURITY FRAMEWORK
-- =======================

-- Vulnerability scans
CREATE TYPE scan_status_enum AS ENUM ('pending', 'running', 'completed', 'failed');
CREATE TYPE vulnerability_severity_enum AS ENUM ('critical', 'high', 'medium', 'low', 'negligible');

CREATE TABLE vulnerability_scans (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    image_name VARCHAR(500) NOT NULL,
    image_tag VARCHAR(100) DEFAULT 'latest',
    scan_date TIMESTAMP DEFAULT NOW(),
    vulnerabilities JSONB DEFAULT '[]',
    severity_counts JSONB DEFAULT '{}',
    status scan_status_enum DEFAULT 'pending',
    scanner_version VARCHAR(50),
    application_id UUID REFERENCES application(id) ON DELETE CASCADE,
    organization_id UUID REFERENCES organization(id) ON DELETE CASCADE,
    created_at TIMESTAMP DEFAULT NOW()
);

-- Security policies
CREATE TYPE security_policy_type_enum AS ENUM ('image-scanning', 'network-policy', 'pod-security', 'rbac-policy');
CREATE TYPE enforcement_level_enum AS ENUM ('warn', 'block', 'audit');

CREATE TABLE security_policies (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL,
    description TEXT,
    type security_policy_type_enum NOT NULL,
    rules JSONB NOT NULL,
    enforcement_level enforcement_level_enum DEFAULT 'warn',
    organization_id UUID REFERENCES organization(id) ON DELETE CASCADE,
    enabled BOOLEAN DEFAULT true,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- =======================
-- WORKFLOW MANAGEMENT
-- =======================

-- Workflow templates
CREATE TYPE workflow_status_enum AS ENUM ('draft', 'active', 'inactive', 'archived');

CREATE TABLE workflow_templates (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL,
    description TEXT,
    definition JSONB NOT NULL,
    version VARCHAR(50) NOT NULL DEFAULT '1.0.0',
    status workflow_status_enum DEFAULT 'draft',
    organization_id UUID REFERENCES organization(id) ON DELETE CASCADE,
    created_by UUID REFERENCES users_temp(id),
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- Workflow executions
CREATE TYPE execution_status_enum AS ENUM ('pending', 'running', 'paused', 'completed', 'failed', 'cancelled');

CREATE TABLE workflow_executions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    template_id UUID REFERENCES workflow_templates(id) ON DELETE CASCADE,
    name VARCHAR(255),
    status execution_status_enum DEFAULT 'pending',
    current_step INTEGER DEFAULT 0,
    context JSONB DEFAULT '{}',
    error_message TEXT,
    started_at TIMESTAMP DEFAULT NOW(),
    completed_at TIMESTAMP,
    triggered_by UUID REFERENCES users_temp(id),
    organization_id UUID REFERENCES organization(id) ON DELETE CASCADE
);

-- Approval requests
CREATE TYPE approval_status_enum AS ENUM ('pending', 'approved', 'rejected', 'expired');

CREATE TABLE approval_requests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workflow_execution_id UUID REFERENCES workflow_executions(id) ON DELETE CASCADE,
    step_id VARCHAR(255) NOT NULL,
    approver_id UUID REFERENCES users_temp(id),
    approver_type VARCHAR(50) DEFAULT 'user', -- user, role, group
    status approval_status_enum DEFAULT 'pending',
    comments TEXT,
    requested_at TIMESTAMP DEFAULT NOW(),
    responded_at TIMESTAMP,
    expires_at TIMESTAMP,
    organization_id UUID REFERENCES organization(id) ON DELETE CASCADE
);

-- =======================
-- COMPLIANCE FRAMEWORK
-- =======================

-- Compliance frameworks
CREATE TABLE compliance_frameworks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL,
    version VARCHAR(50),
    description TEXT,
    controls JSONB NOT NULL DEFAULT '[]',
    organization_id UUID REFERENCES organization(id) ON DELETE CASCADE,
    enabled BOOLEAN DEFAULT false,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- Compliance assessments
CREATE TYPE assessment_status_enum AS ENUM ('draft', 'in-progress', 'completed', 'approved', 'rejected');

CREATE TABLE compliance_assessments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    framework_id UUID REFERENCES compliance_frameworks(id) ON DELETE CASCADE,
    name VARCHAR(255),
    assessment_date DATE DEFAULT CURRENT_DATE,
    results JSONB NOT NULL DEFAULT '{}',
    score DECIMAL(5,2),
    status assessment_status_enum DEFAULT 'draft',
    assessor_id UUID REFERENCES users_temp(id),
    organization_id UUID REFERENCES organization(id) ON DELETE CASCADE,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- Policy violations
CREATE TYPE violation_severity_enum AS ENUM ('critical', 'high', 'medium', 'low', 'info');
CREATE TYPE violation_status_enum AS ENUM ('open', 'acknowledged', 'resolved', 'false-positive');

CREATE TABLE policy_violations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    policy_id UUID,
    resource_type VARCHAR(100),
    resource_id UUID,
    violation_type VARCHAR(100) NOT NULL,
    severity violation_severity_enum DEFAULT 'medium',
    status violation_status_enum DEFAULT 'open',
    description TEXT,
    remediation_steps TEXT[],
    detected_at TIMESTAMP DEFAULT NOW(),
    resolved_at TIMESTAMP,
    resolved_by UUID REFERENCES users_temp(id),
    organization_id UUID REFERENCES organization(id) ON DELETE CASCADE
);

-- =======================
-- COST MANAGEMENT
-- =======================

-- Resource costs
CREATE TYPE resource_type_enum AS ENUM ('cpu', 'memory', 'storage', 'network', 'load-balancer', 'cluster');

CREATE TABLE resource_costs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    resource_type resource_type_enum NOT NULL,
    resource_id UUID,
    resource_name VARCHAR(255),
    usage_amount DECIMAL(15,6),
    cost_amount DECIMAL(15,2),
    currency VARCHAR(3) DEFAULT 'USD',
    period_start TIMESTAMP NOT NULL,
    period_end TIMESTAMP NOT NULL,
    metadata JSONB DEFAULT '{}',
    organization_id UUID REFERENCES organization(id) ON DELETE CASCADE,
    project_id UUID REFERENCES project(id) ON DELETE SET NULL,
    created_at TIMESTAMP DEFAULT NOW()
);

-- Budgets
CREATE TYPE budget_period_enum AS ENUM ('monthly', 'quarterly', 'yearly');
CREATE TYPE budget_status_enum AS ENUM ('active', 'exceeded', 'disabled');

CREATE TABLE budgets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL,
    description TEXT,
    amount DECIMAL(15,2) NOT NULL,
    currency VARCHAR(3) DEFAULT 'USD',
    period budget_period_enum NOT NULL,
    alert_thresholds DECIMAL[] DEFAULT '{50,80,100}',
    status budget_status_enum DEFAULT 'active',
    organization_id UUID REFERENCES organization(id) ON DELETE CASCADE,
    project_id UUID REFERENCES project(id) ON DELETE CASCADE,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- Cost optimization recommendations
CREATE TYPE recommendation_type_enum AS ENUM ('rightsizing', 'unused-resources', 'reserved-instances', 'spot-instances', 'storage-optimization');
CREATE TYPE recommendation_priority_enum AS ENUM ('high', 'medium', 'low');
CREATE TYPE recommendation_status_enum AS ENUM ('pending', 'applied', 'dismissed', 'scheduled');

CREATE TABLE cost_recommendations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    type recommendation_type_enum NOT NULL,
    resource_type VARCHAR(100),
    resource_id UUID,
    resource_name VARCHAR(255),
    current_cost DECIMAL(15,2),
    potential_savings DECIMAL(15,2),
    recommendation_text TEXT NOT NULL,
    implementation_steps TEXT[],
    priority recommendation_priority_enum DEFAULT 'medium',
    status recommendation_status_enum DEFAULT 'pending',
    organization_id UUID REFERENCES organization(id) ON DELETE CASCADE,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- =======================
-- ADVANCED MONITORING
-- =======================

-- Service Level Objectives
CREATE TYPE sli_type_enum AS ENUM ('availability', 'latency', 'error-rate', 'throughput');

CREATE TABLE service_level_objectives (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL,
    description TEXT,
    service_name VARCHAR(255),
    sli_type sli_type_enum NOT NULL,
    target_value DECIMAL(5,4) NOT NULL,
    time_window INTERVAL NOT NULL,
    organization_id UUID REFERENCES organization(id) ON DELETE CASCADE,
    application_id UUID REFERENCES application(id) ON DELETE CASCADE,
    enabled BOOLEAN DEFAULT true,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- Alert rules
CREATE TYPE alert_severity_enum AS ENUM ('critical', 'warning', 'info');
CREATE TYPE alert_status_enum AS ENUM ('active', 'resolved', 'silenced');

CREATE TABLE alert_rules (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL,
    description TEXT,
    query TEXT NOT NULL,
    condition JSONB,
    severity alert_severity_enum DEFAULT 'warning',
    escalation_policy_id UUID,
    organization_id UUID REFERENCES organization(id) ON DELETE CASCADE,
    enabled BOOLEAN DEFAULT true,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- Alert instances
CREATE TABLE alert_instances (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    rule_id UUID REFERENCES alert_rules(id) ON DELETE CASCADE,
    status alert_status_enum DEFAULT 'active',
    message TEXT,
    labels JSONB DEFAULT '{}',
    annotations JSONB DEFAULT '{}',
    started_at TIMESTAMP DEFAULT NOW(),
    resolved_at TIMESTAMP,
    organization_id UUID REFERENCES organization(id) ON DELETE CASCADE
);

-- =======================
-- MULTI-REGION SUPPORT
-- =======================

-- Regions
CREATE TYPE region_provider_enum AS ENUM ('aws', 'gcp', 'azure', 'on-premise');
CREATE TYPE region_status_enum AS ENUM ('active', 'maintenance', 'offline');

CREATE TABLE regions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL,
    provider region_provider_enum,
    location JSONB, -- Geographic location data
    capabilities TEXT[] DEFAULT '{}',
    status region_status_enum DEFAULT 'active',
    metadata JSONB DEFAULT '{}',
    organization_id UUID REFERENCES organization(id) ON DELETE CASCADE,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- Cross-region deployments
CREATE TYPE replication_strategy_enum AS ENUM ('active-active', 'active-passive', 'multi-master');

CREATE TABLE cross_region_deployments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL,
    application_id UUID REFERENCES application(id) ON DELETE CASCADE,
    primary_region_id UUID REFERENCES regions(id),
    replica_regions UUID[] DEFAULT '{}',
    replication_strategy replication_strategy_enum DEFAULT 'active-passive',
    failover_policy JSONB DEFAULT '{}',
    organization_id UUID REFERENCES organization(id) ON DELETE CASCADE,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- Disaster recovery plans
CREATE TABLE disaster_recovery_plans (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL,
    description TEXT,
    definition JSONB NOT NULL,
    rto_minutes INTEGER, -- Recovery Time Objective
    rpo_minutes INTEGER, -- Recovery Point Objective
    last_tested TIMESTAMP,
    next_test_date TIMESTAMP,
    organization_id UUID REFERENCES organization(id) ON DELETE CASCADE,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- =======================
-- AUDIT AND ACTIVITY LOGS
-- =======================

-- Enhanced audit logs
CREATE TYPE audit_action_enum AS ENUM (
    'create', 'read', 'update', 'delete', 
    'deploy', 'rollback', 'approve', 'reject',
    'login', 'logout', 'invite', 'remove'
);

CREATE TYPE audit_resource_enum AS ENUM (
    'application', 'database', 'project', 'organization', 'user',
    'deployment', 'workflow', 'policy', 'cluster', 'backup'
);

CREATE TABLE audit_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users_temp(id),
    organization_id UUID REFERENCES organization(id) ON DELETE CASCADE,
    action audit_action_enum NOT NULL,
    resource_type audit_resource_enum NOT NULL,
    resource_id UUID,
    resource_name VARCHAR(255),
    metadata JSONB DEFAULT '{}',
    ip_address INET,
    user_agent TEXT,
    timestamp TIMESTAMP DEFAULT NOW(),
    session_id VARCHAR(255)
);

-- =======================
-- INDEXES FOR PERFORMANCE
-- =======================

-- Kubernetes indexes
CREATE INDEX idx_k8s_clusters_org ON kubernetes_clusters(organization_id);
CREATE INDEX idx_k8s_deployments_cluster ON k8s_deployments(cluster_id);
CREATE INDEX idx_k8s_deployments_app ON k8s_deployments(application_id);
CREATE INDEX idx_k8s_deployments_status ON k8s_deployments(status);

-- Security indexes
CREATE INDEX idx_vulnerability_scans_app ON vulnerability_scans(application_id);
CREATE INDEX idx_vulnerability_scans_org ON vulnerability_scans(organization_id);
CREATE INDEX idx_vulnerability_scans_date ON vulnerability_scans(scan_date);

-- Workflow indexes
CREATE INDEX idx_workflow_executions_template ON workflow_executions(template_id);
CREATE INDEX idx_workflow_executions_org ON workflow_executions(organization_id);
CREATE INDEX idx_workflow_executions_status ON workflow_executions(status);
CREATE INDEX idx_approval_requests_execution ON approval_requests(workflow_execution_id);
CREATE INDEX idx_approval_requests_approver ON approval_requests(approver_id);

-- Compliance indexes
CREATE INDEX idx_compliance_assessments_framework ON compliance_assessments(framework_id);
CREATE INDEX idx_compliance_assessments_org ON compliance_assessments(organization_id);
CREATE INDEX idx_policy_violations_org ON policy_violations(organization_id);
CREATE INDEX idx_policy_violations_status ON policy_violations(status);

-- Cost management indexes
CREATE INDEX idx_resource_costs_org ON resource_costs(organization_id);
CREATE INDEX idx_resource_costs_project ON resource_costs(project_id);
CREATE INDEX idx_resource_costs_period ON resource_costs(period_start, period_end);
CREATE INDEX idx_budgets_org ON budgets(organization_id);

-- Monitoring indexes
CREATE INDEX idx_slo_org ON service_level_objectives(organization_id);
CREATE INDEX idx_slo_app ON service_level_objectives(application_id);
CREATE INDEX idx_alert_rules_org ON alert_rules(organization_id);
CREATE INDEX idx_alert_instances_rule ON alert_instances(rule_id);

-- Audit indexes
CREATE INDEX idx_audit_logs_user ON audit_logs(user_id);
CREATE INDEX idx_audit_logs_org ON audit_logs(organization_id);
CREATE INDEX idx_audit_logs_timestamp ON audit_logs(timestamp);
CREATE INDEX idx_audit_logs_resource ON audit_logs(resource_type, resource_id);

-- =======================
-- FUNCTIONS AND TRIGGERS
-- =======================

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Apply updated_at triggers to relevant tables
CREATE TRIGGER update_kubernetes_clusters_updated_at 
    BEFORE UPDATE ON kubernetes_clusters 
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_k8s_deployments_updated_at 
    BEFORE UPDATE ON k8s_deployments 
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_enterprise_roles_updated_at 
    BEFORE UPDATE ON enterprise_roles 
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_workflow_templates_updated_at 
    BEFORE UPDATE ON workflow_templates 
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_compliance_frameworks_updated_at 
    BEFORE UPDATE ON compliance_frameworks 
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_budgets_updated_at 
    BEFORE UPDATE ON budgets 
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Function to automatically create audit log entries
CREATE OR REPLACE FUNCTION create_audit_log()
RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO audit_logs (
        user_id,
        organization_id,
        action,
        resource_type,
        resource_id,
        resource_name,
        metadata
    ) VALUES (
        COALESCE(current_setting('app.current_user_id', true)::UUID, NULL),
        COALESCE(NEW.organization_id, OLD.organization_id),
        CASE 
            WHEN TG_OP = 'INSERT' THEN 'create'::audit_action_enum
            WHEN TG_OP = 'UPDATE' THEN 'update'::audit_action_enum
            WHEN TG_OP = 'DELETE' THEN 'delete'::audit_action_enum
        END,
        TG_ARGV[0]::audit_resource_enum,
        COALESCE(NEW.id, OLD.id),
        COALESCE(NEW.name, OLD.name),
        jsonb_build_object(
            'table', TG_TABLE_NAME,
            'operation', TG_OP,
            'old_values', CASE WHEN TG_OP != 'INSERT' THEN row_to_json(OLD) ELSE NULL END,
            'new_values', CASE WHEN TG_OP != 'DELETE' THEN row_to_json(NEW) ELSE NULL END
        )
    );
    
    RETURN COALESCE(NEW, OLD);
END;
$$ language 'plpgsql';

-- =======================
-- SAMPLE DATA FOR DEVELOPMENT
-- =======================

-- Insert sample compliance framework (SOC 2)
INSERT INTO compliance_frameworks (name, version, description, controls, organization_id, enabled) 
SELECT 
    'SOC 2 Type II',
    '2017',
    'Service Organization Control 2 Type II compliance framework',
    '[
        {
            "id": "CC1.1",
            "title": "COSO Principle 1",
            "description": "The entity demonstrates a commitment to integrity and ethical values.",
            "category": "Control Environment",
            "requirements": [
                "Code of conduct is documented and communicated",
                "Ethics violations are investigated and resolved"
            ]
        },
        {
            "id": "CC2.1", 
            "title": "COSO Principle 3",
            "description": "Management establishes structures, reporting lines, and appropriate authorities.",
            "category": "Control Environment",
            "requirements": [
                "Organizational structure is documented",
                "Roles and responsibilities are defined"
            ]
        }
    ]'::jsonb,
    id,
    false
FROM organization 
LIMIT 1;

-- Insert sample enterprise roles
INSERT INTO enterprise_roles (name, description, permissions, organization_id) 
SELECT 
    'Platform Administrator',
    'Full platform administrative access',
    '{
        "kubernetes": ["*"],
        "compliance": ["*"],
        "security": ["*"],
        "cost-management": ["*"],
        "workflows": ["*"]
    }'::jsonb,
    id
FROM organization 
LIMIT 1;

INSERT INTO enterprise_roles (name, description, permissions, organization_id) 
SELECT 
    'Developer',
    'Standard developer access',
    '{
        "applications": ["create", "read", "update", "deploy"],
        "databases": ["create", "read", "update"],
        "projects": ["read"],
        "workflows": ["read", "execute"]
    }'::jsonb,
    id
FROM organization 
LIMIT 1;

-- Insert sample budget
INSERT INTO budgets (name, description, amount, period, organization_id, project_id)
SELECT 
    'Monthly Development Budget',
    'Budget for development environment resources',
    5000.00,
    'monthly'::budget_period_enum,
    o.id,
    p.id
FROM organization o
CROSS JOIN project p
WHERE p.organization_id = o.id
LIMIT 1;

COMMENT ON SCHEMA public IS 'Dokploy Enterprise Edition - Extended database schema for enterprise features including Kubernetes management, advanced security, compliance frameworks, workflow management, cost optimization, and comprehensive monitoring capabilities.';