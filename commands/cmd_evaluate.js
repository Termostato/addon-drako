const { SlashCommandBuilder } = require('@discordjs/builders');
const { EmbedBuilder } = require('discord.js');
const { getStaffStats } = require('../utils/statsHelper');
const { hasPermission } = require('../utils/permissionHelper');
const { StaffActivity, ChannelActivity } = require('../models/schemas');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('evaluar')
        .setDescription('Evalúa las estadísticas de actividad de un usuario')
        .addUserOption(option =>
            option.setName('usuario')
                .setDescription('Usuario a evaluar')
                .setRequired(true))
        .addStringOption(option =>
            option.setName('periodo')
                .setDescription('Período de tiempo a analizar')
                .setRequired(true)
                .addChoices(
                    { name: '7 Días', value: '7d' },
                    { name: '15 Días', value: '15d' },
                    { name: '30 Días', value: '30d' },
                    { name: 'Todos los tiempos', value: 'all' }
                ))
        .addBooleanOption(option =>
            option.setName('es_personal')
                .setDescription('Incluir métricas específicas del personal')
                .setRequired(true)),

    async execute(interaction, client) {
        // Verifica permisos
        if (!hasPermission(interaction.member, 'evaluate', client)) {
            return interaction.reply({
                content: 'No tienes permiso para usar este comando.',
                ephemeral: true
            });
        }

        await interaction.deferReply();

        try {
            const targetUser = interaction.options.getUser('usuario');
            const period = interaction.options.getString('periodo');
            const isStaff = interaction.options.getBoolean('es_personal');

            // Obtiene estadísticas específicas (puedes ajustar la función a tus necesidades)
            const stats = await getStaffStats(targetUser.id, period);
            
            if (!stats) {
                return interaction.editReply('No hay datos de actividad disponibles para este usuario.');
            }

            // Obtiene estadísticas de canales para este usuario y período
            const channelStats = await getChannelActivity(targetUser.id, period, client);

            // Obtiene la hora pico de actividad
            const peakHour = await getPeakActivityHour(targetUser.id, period);

            // Obtiene la posición en el ranking general
            const position = await getLeaderboardPosition(targetUser.id, period);

            // Crea el embed con la información
            const embed = new EmbedBuilder()
                .setTitle(`📊 Evaluación de actividad para ${targetUser.tag}`)
                .setColor(client.staffConfig.panel.embed.color)
                .setDescription(`Mostrando estadísticas para: ${getPeriodLabel(period)}`)
                .addFields(
                    {
                        name: '📝 Actividad de mensajes',
                        value: `Promedio diario: **${Math.round(stats.averages.messages)}**\nPromedio por hora: **${Math.round(stats.averages.messages / 24)}**\nMensajes totales: **${stats.totals.messages}**`,
                        inline: false
                    }
                );

            // Si el usuario es personal, agregar campos específicos
            if (isStaff) {
                embed.addFields(
                    {
                        name: '⚡ Horas de servicio',
                        value: `Total: **${Math.round(stats.totals.duty)}** horas\nPromedio diario: **${Math.round(stats.averages.duty)}** horas`,
                        inline: true
                    },
                    {
                        name: '💤 Horas fuera de servicio',
                        value: `Total: **${Math.round(stats.totals.offDuty)}** horas\nPromedio diario: **${Math.round(stats.averages.offDuty)}** horas`,
                        inline: true
                    }
                );
            }

            // Muestra los canales más activos
            const channelList = channelStats
                .slice(0, 3)
                .map((ch, index) => `${index + 1}. <#${ch.channelId}> - **${ch.messages}** mensajes`)
                .join('\n');

            embed.addFields({
                name: '📊 Canales más activos',
                value: channelList || 'No se encontró actividad en canales',
                inline: false
            });

            // Agrega la hora pico si existe
            if (peakHour !== null) {
                const today = new Date();
                today.setHours(peakHour, 0, 0, 0);
                
                embed.addFields({
                    name: '⏰ Hora pico de actividad',
                    value: `Mayor actividad a las <t:${Math.floor(today.getTime() / 1000)}:t>`,
                    inline: true
                });
            }

            // Agrega la posición en la tabla de clasificación si existe
            if (position) {
                embed.addFields({
                    name: '🏆 Posición en la clasificación',
                    value: `#${position} en actividad del servidor`,
                    inline: true
                });
            }

            embed.setTimestamp();

            await interaction.editReply({ embeds: [embed] });

        } catch (error) {
            console.error('Error en el comando evaluar:', error);
            await interaction.editReply('Ocurrió un error al evaluar la actividad del usuario.');
        }
    }
};

// Función para obtener la actividad de canal para un usuario
async function getChannelActivity(userId, period, client) {
    const startDate = getStartDate(period);
    const excludedChannels = client.staffConfig?.excludedChannelIds || [];
    const excludedCategories = client.staffConfig?.excludedCategoryIds || [];
    
    const channels = await ChannelActivity.aggregate([
        {
            $match: {
                userId: userId,
                timestamp: { $gte: startDate },
                channelId: { $nin: excludedChannels }
            }
        },
        {
            $group: {
                _id: '$channelId',
                messages: { $sum: '$messageCount' }
            }
        },
        {
            $sort: { messages: -1 }
        },
        {
            $limit: 3
        },
        {
            $project: {
                channelId: '$_id',
                messages: 1,
                _id: 0
            }
        }
    ]);

    return channels || [];
}

// Función para obtener la hora pico de actividad
async function getPeakActivityHour(userId, period) {
    const startDate = getStartDate(period);
    
    const result = await ChannelActivity.aggregate([
        {
            $match: {
                userId: userId,
                timestamp: { $gte: startDate }
            }
        },
        {
            $group: {
                _id: '$hourOfDay',
                count: { $sum: '$messageCount' }
            }
        },
        {
            $sort: { count: -1 }
        },
        {
            $limit: 1
        }
    ]);

    return result[0]?._id || null;
}

// Función para obtener la posición en la tabla de clasificación
async function getLeaderboardPosition(userId, period) {
    const startDate = getStartDate(period);
    
    const rankings = await ChannelActivity.aggregate([
        {
            $match: {
                timestamp: { $gte: startDate }
            }
        },
        {
            $group: {
                _id: '$userId',
                total: { $sum: '$messageCount' }
            }
        },
        {
            $sort: { total: -1 }
        }
    ]);

    const position = rankings.findIndex(r => r._id === userId) + 1;
    return position > 0 ? position : null;
}

// Función para obtener la fecha de inicio basada en el período
function getStartDate(period) {
    const date = new Date();
    switch (period) {
        case '24h':
            date.setHours(date.getHours() - 24);
            break;
        case '3d':
            date.setDate(date.getDate() - 3);
            break;
        case '7d':
            date.setDate(date.getDate() - 7);
            break;
        case '15d':
            date.setDate(date.getDate() - 15);
            break;
        case '30d':
            date.setDate(date.getDate() - 30);
            break;
        case 'all':
            date.setFullYear(2000);
            break;
    }
    return date;
}

// Función para obtener el recuento de días basado en el período
function getDayCount(period) {
    switch (period) {
        case '24h': return 1;
        case '3d': return 3;
        case '7d': return 7;
        case '15d': return 15;
        case '30d': return 30;
        case 'all': return 30;
        default: return 7;
    }
}

// Función para obtener la etiqueta de texto del período
function getPeriodLabel(period) {
    const labels = {
        '7d': 'Últimos 7 Días',
        '15d': 'Últimos 15 Días',
        '30d': 'Últimos 30 Días',
        'all': 'Todos los tiempos'
    };
    return labels[period] || period;
}