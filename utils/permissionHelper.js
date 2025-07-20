module.exports = {
    hasPermission: (member, commandName, client) => {
        const allowedRoles = client.staffConfig.commands[commandName]?.roles || [];
        
        return member.roles.cache.some(role => allowedRoles.includes(role.id));
    }
}; 