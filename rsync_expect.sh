#!/usr/bin/expect -f
set timeout -1
spawn rsync -avz -e "ssh -p 5555" --exclude 'node_modules' --exclude '.next' --exclude '.git' /Users/user/GuildServer/guildserver-paas/ usher-node@153.67.71.124:~/guildserver-paas/
expect "password:"
send "guildserver123\r"
expect eof
