import { db, users, organizations, members, projects, applications } from "./index";
import { faker } from "@faker-js/faker";

async function seed() {
  console.log("🌱 Seeding database...");

  try {
    // Create admin user
    const [adminUser] = await db.insert(users).values({
      email: "admin@guildserver.com",
      name: "GuildServer Admin",
      role: "admin",
      password: "$2a$12$LQv3c1yqBw9uK6PfgzK2W.3vAJWJh1M5Z8L2qO5X7vW2c9I1p2s3e", // "password123"
      emailVerified: new Date(),
    }).returning();

    // Create sample organization
    const [sampleOrg] = await db.insert(organizations).values({
      name: "Acme Corporation",
      slug: "acme-corp",
      description: "Sample organization for development",
      ownerId: adminUser.id,
    }).returning();

    // Add admin as owner of organization
    await db.insert(members).values({
      userId: adminUser.id,
      organizationId: sampleOrg.id,
      role: "owner",
      permissions: {
        admin: true,
        projects: ["create", "read", "update", "delete"],
        applications: ["create", "read", "update", "delete", "deploy"],
        databases: ["create", "read", "update", "delete"],
        workflows: ["create", "read", "update", "delete", "execute"],
      },
    });

    // Create sample project
    const [sampleProject] = await db.insert(projects).values({
      name: "Sample Web Application",
      description: "A sample web application for demonstration",
      organizationId: sampleOrg.id,
      environment: {
        NODE_ENV: "development",
        APP_NAME: "sample-app",
      },
    }).returning();

    // Create sample application
    await db.insert(applications).values({
      name: "Frontend App",
      appName: "frontend-app",
      description: "React frontend application",
      projectId: sampleProject.id,
      sourceType: "github",
      repository: "https://github.com/example/frontend-app",
      branch: "main",
      buildType: "dockerfile",
      dockerImage: "node:18-alpine",
      environment: {
        NODE_ENV: "production",
        API_URL: "http://api:3001",
      },
      memoryLimit: 512,
      cpuLimit: "0.5",
      replicas: 2,
      autoDeployment: true,
    });

    // Create additional demo users
    const demoUsers = [];
    for (let i = 0; i < 5; i++) {
      const [user] = await db.insert(users).values({
        email: faker.internet.email(),
        name: faker.person.fullName(),
        role: "user",
        password: "$2a$12$LQv3c1yqBw9uK6PfgzK2W.3vAJWJh1M5Z8L2qO5X7vW2c9I1p2s3e",
        emailVerified: new Date(),
      }).returning();
      
      demoUsers.push(user);

      // Add user to organization
      await db.insert(members).values({
        userId: user.id,
        organizationId: sampleOrg.id,
        role: i === 0 ? "admin" : "member",
        permissions: {
          projects: ["read"],
          applications: ["read", "deploy"],
          databases: ["read"],
        },
      });
    }

    console.log("✅ Database seeded successfully!");
    console.log(`👤 Admin user: admin@guildserver.com / password123`);
    console.log(`🏢 Organization: ${sampleOrg.name} (${sampleOrg.slug})`);
    console.log(`📁 Project: ${sampleProject.name}`);
    console.log(`👥 Created ${demoUsers.length} demo users`);

  } catch (error) {
    console.error("❌ Seeding failed:", error);
    process.exit(1);
  }
}

seed();