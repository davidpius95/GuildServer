import re

with open("apps/web/src/app/dashboard/templates/page.tsx", "r") as f:
    content = f.read()

# Replace build paths
content = content.replace('buildPath: "vercel/', 'buildPath: "official/')

# Replace IDs
content = content.replace('id: "vercel-', 'id: "official-')

# Replace Vercel AI SDK text
content = content.replace('Vercel AI SDK', 'AI SDK')

# Replace Vercel text if any
content = content.replace('Vercel ', 'GuildServer ')

with open("apps/web/src/app/dashboard/templates/page.tsx", "w") as f:
    f.write(content)

