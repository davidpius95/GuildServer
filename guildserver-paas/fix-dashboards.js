const fs = require('fs');
const path = require('path');

const dir = './monitoring/grafana/dashboards';
const files = fs.readdirSync(dir).filter(f => f.endsWith('.json'));

for (const file of files) {
  const filePath = path.join(dir, file);
  const data = fs.readFileSync(filePath, 'utf8');
  
  try {
    const json = JSON.parse(data);
    
    // Recursive function to replace string datasources
    function fixDatasource(obj) {
      if (!obj || typeof obj !== 'object') return;
      
      // If we are at an object that has a datasource property as a string
      if (obj.datasource === 'Prometheus' || obj.datasource === '${DS_PROMETHEUS}') {
        obj.datasource = { type: 'prometheus', uid: 'Prometheus' };
      }
      
      // Also fix variables that might refer to the datasource
      if (obj.type === 'query' && (obj.datasource === 'Prometheus' || obj.datasource === '${DS_PROMETHEUS}')) {
        obj.datasource = { type: 'prometheus', uid: 'Prometheus' };
      }
      
      for (const key in obj) {
        fixDatasource(obj[key]);
      }
    }
    
    fixDatasource(json);
    fs.writeFileSync(filePath, JSON.stringify(json, null, 2));
    console.log(`Fixed ${file}`);
  } catch (e) {
    console.error(`Failed to parse ${file}: ${e.message}`);
  }
}
