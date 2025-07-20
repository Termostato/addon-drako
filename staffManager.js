const fs = require('fs');
const path = require('path');
const { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } = require('discord.js');
const { DutyLog, StaffActivity, VerificationLog, Panel } = require('./models/schemas');
const { loadConfig } = require('./utils/configLoader');
const logger = require('./utils/logger');
const yaml = require('yaml');

module.exports.run = async (client) => {
    const configPath = './addons/StaffManager/config.yml';
    const configFile = fs.readFileSync(configPath, 'utf8');
    client.staffConfig = yaml.parse(configFile);

    if (!client.isReady()) {
        await new Promise(resolve => client.once('ready', resolve));
    }

    await initializeDutyPanel(client);

    const eventFiles = fs.readdirSync(path.join(__dirname, 'events'))
        .filter(file => file.endsWith('.js'));
    for (const file of eventFiles) {
        const event = require(`./events/${file}`);
        event.run(client);
    }

    client.on('interactionCreate', async (interaction) => {
        if (!interaction.isButton()) return;
        
        const staffButtons = ['duty_enter', 'mode_active', 'mode_invisible', 'duty_leave', 'duty_leave_confirm', 'duty_leave_cancel'];
        if (!staffButtons.includes(interaction.customId)) return;

        if (!interaction.member.roles.cache.has(client.staffConfig.roles.staff)) {
            return interaction.reply({
                content: 'No tienes permiso para usar este panel.',
                ephemeral: true
            });
        }

        try {
            switch (interaction.customId) {
                case 'duty_enter':
                    const canEnter = await client.staffManager.canEnterDuty(interaction.user.id);
                    if (!canEnter.allowed) {
                        await interaction.reply({
                            content: `❌ ${canEnter.reason}`,
                            ephemeral: true
                        });
                        return;
                    }

                    const existingDuty = await DutyLog.findOne({
                        userId: interaction.user.id,
                        status: 'active'
                    });

                    if (existingDuty) {
                        return interaction.reply({
                            content: 'Ya estas en trabajo!',
                            ephemeral: true
                        });
                    }

                    const guild = client.guilds.cache.first();
                    if (!guild) return;

                    const member = await guild.members.fetch(interaction.user.id);
                    const currentStatus = member?.presence?.status || 'offline';
                    const isAvailable = currentStatus !== 'offline' && currentStatus !== 'idle';

                    const row = new ActionRowBuilder()
                        .addComponents(
                            new ButtonBuilder()
                                .setCustomId('mode_active')
                                .setLabel('Entrar en modo Activo')
                                .setStyle('Primary')
                                .setDisabled(!isAvailable),
                            new ButtonBuilder()
                                .setCustomId('mode_invisible')
                                .setLabel('Entrar en modo Invisible')
                                .setStyle('Secondary')
                                .setDisabled(!isAvailable)
                        );

                    await interaction.reply({ 
                        content: 'Selecciona tu modo de estado:',
                        components: [row],
                        ephemeral: true
                    });
                    break;

                case 'mode_active':
                    await handleActiveMode(interaction, client);
                    break;

                case 'mode_invisible':
                    await handleInvisibleMode(interaction, client);
                    break;

                case 'duty_leave':
                    await handleDutyLeave(interaction, client);
                    break;

                case 'duty_leave_confirm':
                    await handleDutyLeaveConfirm(interaction, client);
                    break;

                case 'duty_leave_cancel':
                    await interaction.update({
                        content: 'Salida de estado cancelada.',
                        components: [],
                        ephemeral: true
                    });
                    break;
            }
        } catch (error) {
            console.error('Error al manejar la interacción del botón:', error);
            await interaction.reply({ 
                content: 'Ocurrió un error al procesar tu solicitud.', 
                ephemeral: true 
            });
        }
    });

    client.staffManager = {
        updateDutyPanel: async () => {
            const panel = await Panel.findOne({ type: 'duty' });
            if (!panel) return;

            try {
                const channel = await client.channels.fetch(client.staffConfig.panel.channel_id);
                if (!channel) return;

                const message = await channel.messages.fetch(panel.messageId);
                if (!message) return;

                const embed = await generateDutyEmbed(client);
                const row = createDutyButtons();

                await message.edit({ embeds: [embed], components: [row] });
            } catch (error) {
                console.error('Error al actualizar el panel de servicio:', error);
            }
        },
        canEnterDuty: async (userId) => {
            const guild = client.guilds.cache.first();
            const member = await guild.members.fetch(userId);
            if (member.presence?.status === 'offline' || member.presence?.status === 'idle') {
                return { allowed: false, reason: 'Tienes que estar online para entrar en modo Staff.' };
            }

            const lastSession = await DutyLog.findOne({
                userId: userId,
                $or: [
                    { status: 'terminated' },
                    { status: 'completed' }
                ]
            }).sort({ end_time: -1 });

            if (lastSession) {
                let cooldownMinutes;
                if (lastSession.status === 'terminated') {
                    cooldownMinutes = lastSession.duty_type === 'active' ? 
                        client.staffConfig.duty.active_mode.cooldown : 
                        client.staffConfig.duty.invisible_mode.verification.cooldown;
                } else {
                    cooldownMinutes = 0;
                }

                const cooldownEnd = new Date(lastSession.end_time.getTime() + (cooldownMinutes * 60 * 1000));
                if (Date.now() < cooldownEnd) {
                    const timeLeft = Math.ceil((cooldownEnd - Date.now()) / 60000);
                    return { 
                        allowed: false, 
                        reason: `Necesitas esperar ${timeLeft} minutos antes de entrar en modo Staff nuevamente.` 
                    };
                }
            }

            return { allowed: true };
        }
    };

    setInterval(() => {
        client.staffManager.updateDutyPanel();
    }, client.staffConfig.panel.refresh_interval * 1000);
};

async function initializeDutyPanel(client) {
    const channel = await client.channels.fetch(client.staffConfig.panel.channel_id);
    if (!channel) return console.error('No se encontró el canal del panel de servicio');

    let panel = await Panel.findOne({ type: 'duty' });
    let panelMessage;

    if (panel) {
        try {
            panelMessage = await channel.messages.fetch(panel.messageId);
        } catch (err) {
            panel = null;
        }
    }

    if (!panel || !panelMessage) {
        const embed = await generateDutyEmbed(client);
        const row = createDutyButtons();

        panelMessage = await channel.send({
            embeds: [embed],
            components: [row]
        });

        await Panel.findOneAndUpdate(
            { type: 'duty' },
            { 
                channelId: channel.id,
                messageId: panelMessage.id,
                type: 'duty'
            },
            { upsert: true }
        );
    }
}

function createDutyButtons() {
    return new ActionRowBuilder()
        .addComponents(
            new ButtonBuilder()
                .setCustomId('duty_enter')
                .setLabel('Entrar')
                .setStyle(ButtonStyle.Success),
            new ButtonBuilder()
                .setCustomId('duty_leave')
                .setLabel('Salir')
                .setStyle(ButtonStyle.Danger)
        );
}

async function generateDutyEmbed(client) {
    const activeStaff = await DutyLog.find({ status: 'active' }).sort({ start_time: 1 });
    
    const offlineTimeout = new Date(
        Date.now() - client.staffConfig.panel.embed.fields.recent_offline.timeout * 60000
    );

    const recentlyOffline = await DutyLog.find({
        status: { $in: ['completed', 'terminated'] },
        end_time: { $gt: offlineTimeout }
    })
    .sort({ end_time: -1 })
    .limit(5);

    const embed = new EmbedBuilder()
        .setTitle(client.staffConfig.panel.embed.title)
        .setDescription(client.staffConfig.panel.embed.description)
        .setColor(client.staffConfig.panel.embed.color)
        .setFooter({ text: client.staffConfig.panel.embed.footer })
        .setTimestamp();

    const activeList = activeStaff.map(staff => 
        `<@${staff.userId}> ${staff.duty_type === 'active' ? '🟢' : '🔵'} - <t:${Math.floor(staff.start_time.getTime() / 1000)}:R>`
    ).join('\n');

    embed.addFields({
        name: client.staffConfig.panel.embed.fields.active_staff.title,
        value: activeList || client.staffConfig.panel.embed.fields.active_staff.empty_message
    });

    if (recentlyOffline.length > 0) {
        const offlineList = recentlyOffline
            .map(staff => 
                `<@${staff.userId}> ${staff.status === 'terminated' ? '❌' : '✅'} - <t:${Math.floor(staff.end_time.getTime() / 1000)}:R>`
            )
            .join('\n');

        if (offlineList) {
            embed.addFields({
                name: client.staffConfig.panel.embed.fields.recent_offline.title,
                value: offlineList || client.staffConfig.panel.embed.fields.recent_offline.empty_message
            });
        }
    }

    return embed;
}

async function handleActiveMode(interaction, client) {
    const existingDuty = await DutyLog.findOne({
        userId: interaction.user.id,
        status: 'active'
    });

    if (existingDuty) {
        return interaction.reply({
            content: 'Ya estas trabajando!',
            ephemeral: true
        });
    }

    const dutyLog = new DutyLog({
        userId: interaction.user.id,
        duty_type: 'active',
        start_time: new Date(),
        status: 'active'
    });
    await dutyLog.save();
    
    client.verificationManager.startVerificationSystem(interaction.user.id, 'active');
    
    await logger.dutyEnter(client, interaction.user.id, 'active');

    await interaction.reply({
        content: '🟢 Estas ahora en modo Activo. Recuerda mantener tu actividad!',
        ephemeral: true
    });

    await client.staffManager.updateDutyPanel();
}

async function handleInvisibleMode(interaction, client) {
    const existingDuty = await DutyLog.findOne({
        userId: interaction.user.id,
        status: 'active'
    });

    if (existingDuty) {
        return interaction.reply({
            content: 'Ya estas trabajando!',
            ephemeral: true
        });
    }

    const dutyLog = new DutyLog({
        userId: interaction.user.id,
        duty_type: 'invisible',
        start_time: new Date(),
        status: 'active'
    });
    await dutyLog.save();
    
    client.verificationManager.startVerificationSystem(interaction.user.id, 'invisible');
    
    await logger.dutyEnter(client, interaction.user.id, 'invisible');

    await interaction.reply({
        content: '🔵 Estas ahora en modo Invisible. ¡Estate atento a tus notificaciones en MD!',
        ephemeral: true
    });

    await client.staffManager.updateDutyPanel();
}

async function handleDutyLeave(interaction, client) {
    const dutySession = await DutyLog.findOne({
        userId: interaction.user.id,
        status: 'active'
    });

    if (!dutySession) {
        return interaction.reply({
            content: 'No estas trabajando!',
            ephemeral: true
        });
    }

    const row = new ActionRowBuilder()
        .addComponents(
            new ButtonBuilder()
                .setCustomId('duty_leave_confirm')
                .setLabel('Confirmar salida')
                .setStyle(ButtonStyle.Danger),
            new ButtonBuilder()
                .setCustomId('duty_leave_cancel')
                .setLabel('Cancelar')
                .setStyle(ButtonStyle.Secondary)
        );

    await interaction.reply({
        content: 'Estas seguro que quieres salir de trabajar?',
        components: [row],
        ephemeral: true
    });
}

async function handleDutyLeaveConfirm(interaction, client) {
    const dutySession = await DutyLog.findOne({
        userId: interaction.user.id,
        status: 'active'
    });

    if (!dutySession) {
        return interaction.reply({
            content: 'No estas trabajando!',
            ephemeral: true
        });
    }

    client.verificationManager.stopVerificationSystem(interaction.user.id);
    
    dutySession.status = 'completed';
    dutySession.end_time = new Date();
    await dutySession.save();

    const duration = Math.floor((Date.now() - dutySession.start_time.getTime()) / 60000);

    await interaction.reply({
        content: `✅ Has completado tu sesión de staff (Duración: ${formatDuration(duration)})`,
        ephemeral: true
    });

    await logger.dutyLeave(client, interaction.user.id, duration, dutySession.duty_type);
    await client.staffManager.updateDutyPanel();
}

function formatDuration(minutes) {
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    return hours > 0 ? `${hours}h ${mins}m` : `${mins}m`;
}

function getTimeSince(date) {
    const now = new Date();
    const diff = now - date;
    const minutes = Math.floor(diff / 60000);
    return minutes < 60 ? `${minutes}m` : `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}