const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

module.exports = {
    loadConfig: () => {
        try {
            const configPath = path.join(__dirname, '..', 'config.yml');
            const configFile = fs.readFileSync(configPath, 'utf8');
            return yaml.load(configFile);
        } catch (error) {
            console.error('Error loading staff manager config:', error);
            return null;
        }
    }
}; 