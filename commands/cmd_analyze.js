const { SlashCommandBuilder } = require('@discordjs/builders');
const { EmbedBuilder } = require('discord.js');
const { StaffActivity, ChannelActivity } = require('../models/schemas');
const { hasPermission } = require('../utils/permissionHelper');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('analizar')
        .setDescription('Analiza estadísticas de actividad de un canal')
        .addChannelOption(option =>
            option.setName('canal')
                .setDescription('Canal para analizar')
                .setRequired(true))
        .addStringOption(option =>
            option.setName('periodo')
                .setDescription('Período de tiempo para analizar')
                .setRequired(true)
                .addChoices(
                    { name: '24 Horas', value: '24h' },
                    { name: '3 Días', value: '3d' },
                    { name: '7 Días', value: '7d' },
                    { name: '15 Días', value: '15d' },
                    { name: '30 Días', value: '30d' },
                    { name: 'Todos los tiempos', value: 'all' }
                )),

    async execute(interaction, client) {
        if (!hasPermission(interaction.member, 'analyze', client)) {
            return interaction.reply({
                content: 'No tienes permiso para usar este comando.',
                ephemeral: true
            });
        }

        await interaction.deferReply();

        try {
            const channel = interaction.options.getChannel('canal');
            const period = interaction.options.getString('periodo');

            if (!channel.guild) {
                return interaction.editReply('¡No se pueden analizar canales de MD (mensajes directos)!');
            }

            const stats = await getChannelStats(channel.id, period, client);
            
            if (!stats) {
                return interaction.editReply('Este canal está excluido del análisis o no hay datos disponibles.');
            }

            const topUsers = await getChannelTopUsers(channel.id, period, client);
            const peakHour = await getChannelPeakHour(channel.id, period, client);

            const embed = new EmbedBuilder()
                .setTitle(`📊 Análisis del canal: #${channel.name}`)
                .setColor(client.staffConfig.panel.embed.color)
                .setDescription(`Estadísticas para ${getPeriodLabel(period)}`)
                .addFields(
                    {
                        name: '📈 Estadísticas de mensajes',
                        value: `Promedio diario: **${Math.round(stats.averagePerDay)}** mensajes\nPromedio por hora: **${Math.round(stats.averagePerHour)}** mensajes`,
                        inline: false
                    },
                    {
                        name: '📝 Mensajes Totales',
                        value: `**${stats.total}** mensajes`,
                        inline: true
                    }
                );

            if (topUsers.length > 0) {
                const userList = topUsers
                    .map((user, index) => `${index + 1}. <@${user.userId}> - **${user.messages}** mensajes`)
                    .join('\n');

                embed.addFields({
                    name: '👥 Usuarios más activos',
                    value: userList,
                    inline: false
                });
            }

            if (peakHour !== null) {
                const today = new Date();
                today.setHours(peakHour, 0, 0, 0);
                
                embed.addFields({
                    name: '⏰ Actividad pico',
                    value: `Mayor actividad a las <t:${Math.floor(today.getTime() / 1000)}:t>`,
                    inline: true
                });
            }

            embed.setTimestamp();

            await interaction.editReply({ embeds: [embed] });

        } catch (error) {
            console.error('Error en el comando analizar:', error);
            await interaction.editReply('Ocurrió un error al analizar la actividad del canal.');
        }
    }
};

async function getChannelStats(channelId, period, client) {
    const startDate = getStartDate(period);
    const channel = client.channels.cache.get(channelId);
    
    if (!channel?.guild) return null;
    
    const excludedChannels = client.staffConfig?.excludedChannelIds || [];
    const excludedCategories = client.staffConfig?.excludedCategoryIds || [];
    
    if (channel.parentId && excludedCategories.includes(channel.parentId)) return null;
    
    if (excludedChannels.includes(channelId)) return null;

    const result = await ChannelActivity.aggregate([
        {
            $match: {
                channelId: channelId,
                timestamp: { $gte: startDate }
            }
        },
        {
            $group: {
                _id: null,
                total: { $sum: '$messageCount' }
            }
        }
    ]);

    const total = result[0]?.total || 0;
    const days = getDayCount(period);
    
    return {
        total: total,
        averagePerDay: total / days,
        averagePerHour: total / (days * 24)
    };
}

async function getChannelTopUsers(channelId, period, client) {
    const startDate = getStartDate(period);
    const channel = client.channels.cache.get(channelId);
    
    if (!channel?.guild) return [];
    
    return await ChannelActivity.aggregate([
        {
            $match: {
                channelId: channelId,
                timestamp: { $gte: startDate }
            }
        },
        {
            $group: {
                _id: '$userId',
                messages: { $sum: '$messageCount' }
            }
        },
        {
            $sort: { messages: -1 }
        },
        {
            $limit: 5
        },
        {
            $project: {
                userId: '$_id',
                messages: 1,
                _id: 0
            }
        }
    ]);
}

async function getChannelPeakHour(channelId, period, client) {
    const startDate = getStartDate(period);
    const channel = client.channels.cache.get(channelId);
    
    if (!channel?.guild) return null;
    
    const result = await ChannelActivity.aggregate([
        {
            $match: {
                channelId: channelId,
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

function getPeriodLabel(period) {
    const labels = {
        '24h': 'Últimas 24 Horas',
        '3d': 'Últimos 3 Días',
        '7d': 'Últimos 7 Días',
        '15d': 'Últimos 15 Días',
        '30d': 'Últimos 30 Días',
        'all': 'Todos los tiempos'
    };
    return labels[period] || period;
}

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