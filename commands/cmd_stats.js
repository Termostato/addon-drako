const { SlashCommandBuilder } = require('@discordjs/builders');
const { EmbedBuilder, AttachmentBuilder } = require('discord.js');
const { generateMetricChart } = require('../utils/chartHelper');
const { getStaffStats, getPeriodLabel } = require('../utils/statsHelper');
const { hasPermission } = require('../utils/permissionHelper');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('estadisticasstaff')
        .setDescription('Ver estadísticas del personal')
        .addUserOption(option =>
            option.setName('usuario')
                .setDescription('Usuario para ver estadísticas (predeterminado: tú)')
                .setRequired(false))
        .addBooleanOption(option =>
            option.setName('mensajes')
                .setDescription('Mostrar estadísticas de mensajes')
                .setRequired(false))
        .addBooleanOption(option =>
            option.setName('voz')
                .setDescription('Mostrar estadísticas de actividad de voz')
                .setRequired(false))
        .addBooleanOption(option =>
            option.setName('servicio')
                .setDescription('Mostrar estadísticas de horas de servicio')
                .setRequired(false))
        .addBooleanOption(option =>
            option.setName('fueraservicio')
                .setDescription('Mostrar estadísticas de horas fuera de servicio')
                .setRequired(false))
        .addBooleanOption(option =>
            option.setName('puntos')
                .setDescription('Mostrar estadísticas de puntos')
                .setRequired(false))
        .addStringOption(option =>
            option.setName('periodo')
                .setDescription('Período de tiempo a ver')
                .addChoices(
                    { name: '4 Días', value: '4d' },
                    { name: '7 Días', value: '7d' },
                    { name: '15 Días', value: '15d' },
                    { name: '30 Días', value: '30d' },
                    { name: 'Todos los tiempos', value: 'all' }
                )
                .setRequired(false)),

    async execute(interaction, client) {
        // Verifica si el miembro tiene permiso para usar este comando
        if (!hasPermission(interaction.member, 'staffstats', client)) {
            return interaction.reply({
                content: 'No tienes permiso para usar este comando.',
                ephemeral: true
            });
        }

        // Defer reply mientras recopilamos datos
        await interaction.deferReply();

        // Obtiene valores de las opciones
        const targetUser = interaction.options.getUser('usuario') || interaction.user;
        const period = interaction.options.getString('periodo') || '7d';

        // Verifica qué métricas se han seleccionado
        const selectedMetrics = [];
        if (interaction.options.getBoolean('mensajes')) selectedMetrics.push('messages');
        if (interaction.options.getBoolean('voz')) selectedMetrics.push('voice');
        if (interaction.options.getBoolean('servicio')) selectedMetrics.push('duty');
        if (interaction.options.getBoolean('fueraservicio')) selectedMetrics.push('offduty');
        if (interaction.options.getBoolean('puntos')) selectedMetrics.push('points');

        // Si no se seleccionó ninguna métrica, se muestran todas por defecto
        if (selectedMetrics.length === 0) {
            selectedMetrics.push('messages', 'voice', 'duty', 'offduty', 'points');
        }

        try {
            // Obtiene las estadísticas para el usuario
            const stats = await getStaffStats(targetUser.id, period);
            if (!stats) {
                return interaction.editReply(`No se encontró ninguna estadística para ${targetUser.tag}`);
            }

            // Crea el embed con la información
            const embed = new EmbedBuilder()
                .setTitle(`📊 Estadísticas de personal para ${targetUser.tag}`)
                .setColor('#5865F2')
                .setDescription(`Mostrando estadísticas para: ${getPeriodLabel(period)}`)
                .addFields(
                    { 
                        name: '📝 Mensajes Totales', 
                        value: `Total: ${stats.totals.messages.toLocaleString()}\nPromedio: ${Math.round(stats.averages.messages).toLocaleString()}/día`, 
                        inline: true 
                    },
                    { 
                        name: '🎤 Horas en voz', 
                        value: `Total: ${Math.round(stats.totals.voice).toLocaleString()}\nPromedio: ${Math.round(stats.averages.voice).toLocaleString()}/día`, 
                        inline: true 
                    },
                    { 
                        name: '⚡ Horas de servicio', 
                        value: `Total: ${Math.round(stats.totals.duty).toLocaleString()}\nPromedio: ${Math.round(stats.averages.duty).toLocaleString()}/día`, 
                        inline: true 
                    },
                    { 
                        name: '💤 Horas fuera de servicio', 
                        value: `Total: ${Math.round(stats.totals.offDuty).toLocaleString()}\nPromedio: ${Math.round(stats.averages.offDuty).toLocaleString()}/día`, 
                        inline: true 
                    }
                )
                .setTimestamp();

            // Si hay estadísticas de puntos, agrégalas
            if (stats.totals.points !== undefined) {
                embed.addFields({
                    name: '⭐ Puntos Totales',
                    value: `Total: ${Math.round(stats.totals.points).toLocaleString()}\nPromedio: ${Math.round(stats.averages.points).toLocaleString()}/día`,
                    inline: true
                });
            }

            // Si el gráfico está habilitado en la configuración, genera la imagen
            if (client.staffConfig.stats.graph.enabled) {
                // Determina cuántos días se deben graficar
                const days = period === 'all' ? 30 : parseInt(period.replace('d', ''));
                const today = new Date();
                today.setHours(23, 59, 59, 999);
                
                // Crea el array de etiquetas (fechas)
                const labels = Array.from({ length: days }, (_, i) => {
                    const d = new Date(today);
                    d.setDate(d.getDate() - (days - i - 1));
                    return d.toLocaleDateString();
                });

                // Configuraciones para las diferentes métricas
                const metricConfigs = {
                    messages: {
                        label: 'Mensajes',
                        data: stats.daily.messages.slice(-days),
                        color: client.staffConfig.stats.graph.colors.messages
                    },
                    voice: {
                        label: 'Horas de voz',
                        data: stats.daily.voice.slice(-days),
                        color: client.staffConfig.stats.graph.colors.voice
                    },
                    duty: {
                        label: 'Horas de servicio',
                        data: stats.daily.duty.slice(-days),
                        color: client.staffConfig.stats.graph.colors.duty
                    },
                    offduty: {
                        label: 'Horas fuera de servicio',
                        data: stats.daily.offDuty.slice(-days),
                        color: client.staffConfig.stats.graph.colors.inactive
                    },
                    points: {
                        label: 'Puntos',
                        data: stats.daily.points ? stats.daily.points.slice(-days) : [],
                        color: client.staffConfig.stats.graph.colors.points || '#FFD700'
                    }
                };

                // Prepara datasets para solo las métricas seleccionadas
                const chartData = {
                    labels: labels,
                    datasets: selectedMetrics
                        .filter(metric => metricConfigs[metric])
                        .map(metric => ({
                            label: metricConfigs[metric].label,
                            data: metricConfigs[metric].data,
                            borderColor: metricConfigs[metric].color,
                            backgroundColor: `${metricConfigs[metric].color}15`,
                            tension: 0.4,
                            fill: true
                        }))
                };

                // Genera la imagen del gráfico
                const chartBuffer = await generateMetricChart(chartData, 'all', period);
                const attachment = new AttachmentBuilder(chartBuffer, { name: 'staff_stats.png' });
                
                // Agrega la imagen al embed
                embed.setImage('attachment://staff_stats.png');
                
                // Edita la respuesta con el embed y el archivo adjunto
                await interaction.editReply({ embeds: [embed], files: [attachment] });
            } else {
                // Si no hay gráfico, solo responde con el embed
                await interaction.editReply({ embeds: [embed] });
            }
        } catch (error) {
            console.error('Error en el comando estadisticasstaff:', error);
            await interaction.editReply('Ocurrió un error al obtener las estadísticas.');
        }
    }
};