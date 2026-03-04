import React from 'react';
import clsx from 'clsx';
import Link from '@docusaurus/Link';
import useDocusaurusContext from '@docusaurus/useDocusaurusContext';
import Layout from '@theme/Layout';

type FeatureItem = {
  title: string;
  icon: string;
  description: string;
  link: string;
};

const features: FeatureItem[] = [
  {
    title: 'Deploy Applications',
    icon: '\u{1F680}',
    description:
      'Push your code and let GuildServer handle the rest. Supports Git-based deployments, Docker images, and multiple build systems including Nixpacks, Dockerfiles, and Heroku buildpacks.',
    link: '/deployment/git-deployments',
  },
  {
    title: 'Managed Databases',
    icon: '\u{1F5C4}',
    description:
      'Provision PostgreSQL, MySQL, MongoDB, and Redis databases with a single click. Automatic backups, connection pooling, and secure credential management included.',
    link: '/concepts/databases',
  },
  {
    title: 'Custom Domains',
    icon: '\u{1F310}',
    description:
      'Attach custom domains to any application with automatic SSL certificate provisioning via Let\'s Encrypt. DNS verification, forced HTTPS, and wildcard support.',
    link: '/concepts/domains',
  },
  {
    title: 'Team Collaboration',
    icon: '\u{1F465}',
    description:
      'Organize work with multi-tenant organizations, role-based access control, granular permissions, and full audit logging. Invite team members and manage access per project.',
    link: '/auth/roles-permissions',
  },
  {
    title: 'Real-time Monitoring',
    icon: '\u{1F4CA}',
    description:
      'Track application health, resource usage, and deployment status in real time. Built-in metrics collection, health checks, alerting, and integration with Prometheus and Grafana.',
    link: '/monitoring/metrics',
  },
  {
    title: 'Enterprise Security',
    icon: '\u{1F512}',
    description:
      'SSO via SAML and OIDC, two-factor authentication, encrypted environment variables, API key management, and SOC 2 / HIPAA compliance features for enterprise workloads.',
    link: '/auth/authentication',
  },
];

function HeroSection() {
  const {siteConfig} = useDocusaurusContext();
  return (
    <header className="hero">
      <div className="container">
        <div style={{textAlign: 'center', maxWidth: 800, margin: '0 auto'}}>
          <h1 className="hero__title">{siteConfig.title}</h1>
          <p className="hero__subtitle">{siteConfig.tagline}</p>
          <div
            style={{
              display: 'flex',
              gap: '1rem',
              justifyContent: 'center',
              marginTop: '2rem',
            }}>
            <Link
              className="button button--primary button--lg"
              to="/getting-started/quickstart">
              Get Started
            </Link>
            <Link
              className="button button--outline button--lg"
              to="/api">
              API Reference
            </Link>
          </div>
        </div>
      </div>
    </header>
  );
}

function FeatureCard({title, icon, description, link}: FeatureItem) {
  return (
    <Link to={link} className="feature-card">
      <div className="feature-icon">{icon}</div>
      <h3>{title}</h3>
      <p>{description}</p>
    </Link>
  );
}

function FeaturesSection() {
  return (
    <section style={{padding: '3rem 0'}}>
      <div className="container">
        <div style={{textAlign: 'center', marginBottom: '2rem'}}>
          <h2 style={{fontSize: '2rem', fontWeight: 700}}>
            Everything you need to deploy and manage applications
          </h2>
          <p style={{opacity: 0.7, maxWidth: 600, margin: '0 auto'}}>
            GuildServer provides a complete platform for deploying, scaling, and
            managing your applications and databases on your own infrastructure.
          </p>
        </div>
        <div className="features-grid">
          {features.map((props, idx) => (
            <FeatureCard key={idx} {...props} />
          ))}
        </div>
      </div>
    </section>
  );
}

export default function Home(): React.JSX.Element {
  const {siteConfig} = useDocusaurusContext();
  return (
    <Layout
      title="Home"
      description={siteConfig.tagline}>
      <HeroSection />
      <main>
        <FeaturesSection />
      </main>
    </Layout>
  );
}
