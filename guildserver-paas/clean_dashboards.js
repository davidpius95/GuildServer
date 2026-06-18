const fs = require('fs');

const files = [
  'monitoring/grafana/dashboards/postgres-9628.json',
  'monitoring/grafana/dashboards/redis-11835.json',
  'monitoring/grafana/dashboards/nodejs-11159.json'
];

files.forEach(file => {
  let data = JSON.parse(fs.readFileSync(file, 'utf8'));
  
  if (data.templating && data.templating.list) {
    // Filter out k8s specific variables
    data.templating.list = data.templating.list.filter(v => 
      !['namespace', 'pod', 'pod_name', 'release'].includes(v.name)
    );
    
    // Fix the 'instance' variable query
    data.templating.list.forEach(v => {
      if (v.name === 'instance') {
        if (file.includes('postgres')) {
          v.query = 'label_values(pg_up, instance)';
          v.definition = 'label_values(pg_up, instance)';
        } else if (file.includes('redis')) {
          v.query = 'label_values(redis_up, instance)';
          v.definition = 'label_values(redis_up, instance)';
        } else if (file.includes('nodejs')) {
          v.query = 'label_values(nodejs_version_info, instance)';
          v.definition = 'label_values(nodejs_version_info, instance)';
        }
      }
    });
  }
  
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
});
