const { EmbedBuilder } = require('discord.js');

module.exports = {
    async log(client, type, data) {
        if (!client.staffConfig.logging.enabled) return;
        
        const channel = await client.channels.fetch(client.staffConfig.logging.channel_id);
        if (!channel) return;

        const config = client.staffConfig.logging.embeds[type];
        if (!config) return;

        let description = config.description;
        Object.entries(data).forEach(([key, value]) => {
            description = description.replace(`{${key}}`, value);
        });

        const embed = new EmbedBuilder()
            .setTitle(config.title)
            .setDescription(description)
            .setColor(config.color)
            .setFooter({ text: config.footer })
            .setTimestamp();

        if (data.user) {
            const user = await client.users.fetch(data.userId);
            embed.setThumbnail(user.displayAvatarURL({ dynamic: true }));
        }

        await channel.send({ embeds: [embed] });
    },

    async dutyEnter(client, userId, type) {
        const embed = new EmbedBuilder()
            .setTitle(client.staffConfig.logging.embeds.duty_enter.title)
            .setDescription(`<@${userId}> ha entrado en servicio ${type}`)
            .setColor(client.staffConfig.logging.embeds.duty_enter.color)
            .addFields(
                { name: 'Modo', value: type.charAt(0).toUpperCase() + type.slice(1), inline: true },
                { name: 'Tiempo', value: `<t:${Math.floor(Date.now() / 1000)}:F>`, inline: true }
            )
            .setFooter({ text: client.staffConfig.logging.embeds.duty_enter.footer })
            .setTimestamp();

        const channel = await client.channels.fetch(client.staffConfig.logging.channel_id);
        if (channel) await channel.send({ embeds: [embed] });
    },

    async dutyLeave(client, userId, duration, dutyType, reason = 'completed') {
        const embed = new EmbedBuilder()
            .setTitle(client.staffConfig.logging.embeds.duty_leave.title)
            .setDescription(`<@${userId}> ha salido del servicio`)
            .setColor(reason === 'completed' ? 
                client.staffConfig.logging.embeds.duty_leave.color : 
                client.staffConfig.logging.embeds.verification.failure.color)
            .addFields(
                { name: 'Modo', value: dutyType.charAt(0).toUpperCase() + dutyType.slice(1), inline: true },
                { name: 'Duracion', value: formatDuration(duration), inline: true },
                { name: 'Estado', value: reason.charAt(0).toUpperCase() + reason.slice(1), inline: true },
                { name: 'Tiempo', value: `<t:${Math.floor(Date.now() / 1000)}:F>`, inline: true }
            )
            .setFooter({ text: client.staffConfig.logging.embeds.duty_leave.footer })
            .setTimestamp();

        const channel = await client.channels.fetch(client.staffConfig.logging.channel_id);
        if (channel) await channel.send({ embeds: [embed] });
    },

    async verificationResult(client, userId, success, reason = null) {
        const embed = new EmbedBuilder()
            .setTitle(success ? '✅ Verificación Exitosa' : '❌ Verificación Fallida')
            .setDescription(`<@${userId}> ha ${success ? 'aprobado' : 'fallado'} su verificación`)
            .setColor(success ? 
                client.staffConfig.logging.embeds.verification.success.color : 
                client.staffConfig.logging.embeds.verification.failure.color
            )
            .addFields(
                { name: 'Estado', value: success ? 'Aprobado' : 'Fallido', inline: true },
                { name: 'Tiempo', value: `<t:${Math.floor(Date.now() / 1000)}:F>`, inline: true }
            );

        if (reason) {
            embed.addFields({ name: 'Razón', value: reason, inline: true });
        }

        embed.setFooter({ 
            text: client.staffConfig.logging.embeds.verification[success ? 'success' : 'failure'].footer 
        });
        embed.setTimestamp();

        const channel = await client.channels.fetch(client.staffConfig.logging.verification_channel_id);
        if (channel) await channel.send({ embeds: [embed] });
    },

    async activityWarning(client, userId, requirement, timeLeft) {
        await this.log(client, 'activity_warning', {
            user: `<@${userId}>`,
            requirement,
            time: timeLeft,
            userId
        });
    },

    async verificationSent(client, userId, code) {
        const embed = new EmbedBuilder()
            .setTitle('📤 Verificación Enviada')
            .setDescription(`<@${userId}> ha recibido un mensaje de verificación.`)
            .setColor(0x5865F2)
            .addFields(
                { name: 'Código', value: `\`${code}\``, inline: true },
                { name: 'Tiempo', value: `<t:${Math.floor(Date.now() / 1000)}:F>`, inline: true }
            )
            .setFooter({ text: 'Sistema de Verificación' })
            .setTimestamp();

        const channel = await client.channels.fetch(client.staffConfig.logging.verification_channel_id);
        if (channel) await channel.send({ embeds: [embed] });
    }
};

function formatDuration(minutes) {
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    return hours > 0 ? `${hours}h ${mins}m` : `${mins}m`;
}