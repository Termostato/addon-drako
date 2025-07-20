const {
  DutyLog,
  StaffActivity,
  VerificationLog,
} = require("../models/schemas");
const logger = require("../utils/logger");
const { EmbedBuilder } = require("discord.js");
const { calculatePoints } = require("../utils/pointsSystem");

module.exports.run = async (client) => {
  const verificationTimers = new Map();
  const activityTimers = new Map();
  const pendingVerifications = new Set();
  const verificationCodes = new Map();
  const staffStatusMonitor = new Map();
  const verificationAttempts = new Map();

  function debugLog(context, ...args) {
    console.log(`[VerificationManager][${context}]`, ...args);
  }

  async function initializeStaffMonitoring() {
    const guild = client.guilds.cache.first();
    if (!guild) return;

    const staffRole = guild.roles.cache.get(client.staffConfig.roles.staff);
    if (!staffRole) return;

    staffRole.members.forEach((member) => {
      staffStatusMonitor.set(member.id, member.presence?.status || "offline");
    });

    setInterval(async () => {
      for (const [userId, lastStatus] of staffStatusMonitor) {
        const member = await guild.members.fetch(userId).catch(() => null);
        if (!member) continue;

        const currentStatus = member.presence?.status || "offline";
        if (currentStatus !== lastStatus) {
          staffStatusMonitor.set(userId, currentStatus);

          if (currentStatus === "offline" || currentStatus === "idle") {
            const dutySession = await DutyLog.findOne({
              userId: userId,
              status: "active",
            });

            if (dutySession) {
              await terminateDuty(userId, `ir en estado ${currentStatus}`);
            }
          }
        }
      }
    }, 5000);
  }

  async function reinitializeVerificationSystem() {
    try {
      const activeSessions = await DutyLog.find({ status: "active" });

      for (const session of activeSessions) {
        const guild = client.guilds.cache.first();
        const member = await guild.members
          .fetch(session.userId)
          .catch(() => null);

        if (
          !member ||
          !member.roles.cache.has(client.staffConfig.roles.staff)
        ) {
          await terminateDuty(
            session.userId,
            "system restart - member invalid"
          );
          continue;
        }

        if (session.duty_type === "invisible") {
          if (!pendingVerifications.has(session.userId)) {
            await scheduleNextVerification(session.userId);
          }
        } else if (session.duty_type === "active") {
          if (!activityTimers.has(session.userId)) {
            const activityTimer = setInterval(
              () => checkActivityRequirements(session.userId),
              60 * 60 * 1000
            );
            activityTimers.set(session.userId, activityTimer);
          }
        }
      }
    } catch (error) {
      console.error("Error reinitializing verification system:", error);
    }
  }

  await initializeStaffMonitoring();
  await reinitializeVerificationSystem();

  client.on("guildMemberUpdate", (oldMember, newMember) => {
    const hasStaffRole = newMember.roles.cache.has(
      client.staffConfig.roles.staff
    );
    const hadStaffRole = oldMember.roles.cache.has(
      client.staffConfig.roles.staff
    );

    if (!hadStaffRole && hasStaffRole) {
      staffStatusMonitor.set(
        newMember.id,
        newMember.presence?.status || "offline"
      );
    } else if (hadStaffRole && !hasStaffRole) {
      staffStatusMonitor.delete(newMember.id);
    }
  });

  async function terminateDuty(userId, reason) {
    const dutySession = await DutyLog.findOne({
      userId: userId,
      status: "active",
    });

    if (!dutySession) return;

    try {
      const duration = Math.floor(
        (Date.now() - dutySession.start_time.getTime()) / 60000
      );

      dutySession.status = "terminated";
      dutySession.end_time = new Date();
      await dutySession.save();

      if (verificationTimers.has(userId)) {
        clearTimeout(verificationTimers.get(userId));
        verificationTimers.delete(userId);
      }
      if (activityTimers.has(userId)) {
        clearInterval(activityTimers.get(userId));
        activityTimers.delete(userId);
      }
      pendingVerifications.delete(userId);
      verificationCodes.delete(userId);

      const user = await client.users.fetch(userId);

      const dmEmbed = {
        title: "❌ Sesión Terminada",
        description: `Tu sesión de servicio ha sido terminada por ${reason}.`,
        color: parseInt(
          client.staffConfig.logging.embeds.duty_terminated.color.replace(
            "#",
            ""
          ),
          16
        ),
        footer: {
          text: "Sistema de Servicio",
        },
        timestamp: new Date(),
      };

      const logEmbed = {
        title: client.staffConfig.logging.embeds.duty_terminated.title,
        description:
          client.staffConfig.logging.embeds.duty_terminated.description
            .replace("{user}", user.tag)
            .replace("{reason}", reason),
        color: parseInt(
          client.staffConfig.logging.embeds.duty_terminated.color.replace(
            "#",
            ""
          ),
          16
        ),
        fields: [
          {
            name: "Duración",
            value: `${duration} minutos`,
            inline: true,
          },
          {
            name: "Tipo de Servicio",
            value: dutySession.duty_type,
            inline: true,
          },
          {
            name: "Timestamp",
            value: `<t:${Math.floor(Date.now() / 1000)}:F>`,
            inline: true,
          },
        ],
        footer: {
          text: client.staffConfig.logging.embeds.duty_terminated.footer,
        },
        timestamp: new Date(),
      };

      await user.send({ embeds: [dmEmbed] });

      const loggingChannel = await client.channels.fetch(
        client.staffConfig.logging.channel_id
      );
      if (loggingChannel) {
        await loggingChannel.send({ embeds: [logEmbed] });
      }

      await client.staffManager.updateDutyPanel();
    } catch (error) {
      console.error("Error in terminateDuty:", error);
    }
  }

  async function sendVerification(userId) {
    if (pendingVerifications.has(userId)) return;

    try {
      pendingVerifications.add(userId);
      const user = await client.users.fetch(userId);
      const code = Math.random().toString(36).substring(2, 8).toUpperCase();

      const embed = new EmbedBuilder()
        .setTitle("🔍 Verificación de Servicio")
        .setDescription(
          `Por favor verifica tu estado de servicio respondiendo con el siguiente código dentro de ${client.staffConfig.duty.invisible_mode.verification.response_time} minutos:\n\`${code}\``
        )
        .setColor(parseInt("5865F2", 16));

      await user.send({ embeds: [embed] });
      await logger.verificationSent(client, userId, code);

      verificationCodes.set(userId, code);

      const responseTimeout = setTimeout(() => {
        handleFailedVerification(userId, user, "timeout");
      }, client.staffConfig.duty.invisible_mode.verification.response_time * 60 * 1000);

      verificationTimers.set(userId, responseTimeout);
    } catch (error) {
      console.error("Error sending verification:", error);
      pendingVerifications.delete(userId);
    }
  }

  async function scheduleNextVerification(userId) {
    if (verificationTimers.has(userId)) {
      clearTimeout(verificationTimers.get(userId));
      verificationTimers.delete(userId);
    }

    if (pendingVerifications.has(userId)) {
      return;
    }

    const config = client.staffConfig.duty.invisible_mode.verification;
    const minInterval = config.interval.min;
    const maxInterval = config.interval.max;

    const interval = Math.floor(
      Math.random() * (maxInterval - minInterval + 1) + minInterval
    );
    const timer = setTimeout(
      () => sendVerification(userId),
      interval * 60 * 1000
    );
    verificationTimers.set(userId, timer);
  }

  async function handleSuccessfulVerification(userId, user) {
    try {
      const attemptCount = verificationAttempts.has(userId) ? 2 : 1;

      await user.send({
        embeds: [
          {
            title: "✅ Verificación Exitosa",
            description: "Has verificado exitosamente tu estado de servicio.",
            color: parseInt("43B581", 16),
            footer: { text: "Sistema de Verificación" },
            timestamp: new Date(),
          },
        ],
      });

      const loggingChannel = await client.channels.fetch(
        client.staffConfig.logging.channel_id
      );
      if (loggingChannel) {
        await loggingChannel.send({
          embeds: [
            {
              title:
                client.staffConfig.logging.embeds.verification.success.title,
              description:
                client.staffConfig.logging.embeds.verification.success.description.replace(
                  "{user}",
                  user.tag
                ),
              color: parseInt(
                client.staffConfig.logging.embeds.verification.success.color.replace(
                  "#",
                  ""
                ),
                16
              ),
              fields: [
                {
                  name: "Estado",
                  value: "Aprobado",
                  inline: true,
                },
                {
                  name: "Intento",
                  value: attemptCount === 2 ? "Segundo Intento" : "Primer Intento",
                  inline: true,
                },
                {
                  name: "Hora",
                  value: `<t:${Math.floor(Date.now() / 1000)}:F>`,
                  inline: true,
                },
              ],
              footer: {
                text: client.staffConfig.logging.embeds.verification.success
                  .footer,
              },
              timestamp: new Date(),
            },
          ],
        });
      }

      verificationCodes.delete(userId);
      pendingVerifications.delete(userId);
      verificationAttempts.delete(userId);

      scheduleNextVerification(userId);

      await calculatePoints(client, userId);
    } catch (error) {
      console.error("Error handling successful verification:", error);
    }
  }

  async function handleFailedVerification(userId, user, reason) {
    try {
      if (reason === "timeout") {
        verificationAttempts.delete(userId);
        verificationCodes.delete(userId);
        pendingVerifications.delete(userId);

        if (verificationTimers.has(userId)) {
          clearTimeout(verificationTimers.get(userId));
          verificationTimers.delete(userId);
        }
        if (activityTimers.has(userId)) {
          clearInterval(activityTimers.get(userId));
          activityTimers.delete(userId);
        }

        await terminateDuty(userId, "verificación fallida: Sin Respuesta");
        return;
      }

      if (!verificationAttempts.has(userId)) {
        verificationAttempts.set(userId, 1);

        await user.send({
          embeds: [
            {
              title: "❌ Código Incorrecto",
              description:
                "El código que ingresaste es incorrecto. Por favor intenta nuevamente con el mismo código.\nAdvertencia: Otro intento incorrecto terminará tu sesión de servicio.",
              color: parseInt("F04747", 16),
              footer: { text: "Sistema de Verificación" },
              timestamp: new Date(),
            },
          ],
        });
        return;
      }

      verificationAttempts.delete(userId);
      verificationCodes.delete(userId);
      pendingVerifications.delete(userId);

      if (verificationTimers.has(userId)) {
        clearTimeout(verificationTimers.get(userId));
        verificationTimers.delete(userId);
      }
      if (activityTimers.has(userId)) {
        clearInterval(activityTimers.get(userId));
        activityTimers.delete(userId);
      }

      await terminateDuty(userId, "verificación fallida: Código Incorrecto");

      await calculatePoints(client, userId);
    } catch (error) {
      console.error("Error handling failed verification:", error);
    }
  }

  client.on("messageCreate", async (message) => {
    if (message.channel.type !== 1) return;
    if (message.author.bot) return;

    const userId = message.author.id;

    if (!verificationCodes.has(userId)) return;

    const expectedCode = verificationCodes.get(userId);
    const receivedCode = message.content.trim().toUpperCase();

    if (receivedCode === expectedCode) {
      if (verificationTimers.has(userId)) {
        clearTimeout(verificationTimers.get(userId));
        verificationTimers.delete(userId);
      }

      await handleSuccessfulVerification(userId, message.author);
    } else {
      await handleFailedVerification(userId, message.author, "Código Incorrecto");
    }
  });

  client.on("interactionCreate", async (interaction) => {
    if (!interaction.isButton()) return;

    if (
      interaction.customId === "mode_invisible" ||
      interaction.customId === "mode_active"
    ) {
      const member = await interaction.guild.members
        .fetch(interaction.user.id)
        .catch(() => null);
      const currentStatus = member?.presence?.status || "offline";

      if (currentStatus === "idle" || currentStatus === "offline") {
        await interaction.reply({
          content: `No puedes entrar en servicio mientras estás ${currentStatus}.`,
          ephemeral: true,
        });
        return;
      }
      await startActivityMonitoring(interaction.user.id);
    }
  });

  async function checkActivityRequirements(userId) {
    const dutySession = await DutyLog.findOne({
      userId: userId,
      status: "active",
    });

    if (!dutySession || dutySession.duty_type !== "active") return;

    const activity = await StaffActivity.findOne({ userId: userId });
    if (!activity) return;

    const messageCount = activity.messages_per_hour || 0;
    const voiceMinutes = activity.voice_minutes_per_hour || 0;

    const messageRequirement =
      client.staffConfig.duty.active_mode.requirements.messages_per_hour;
    const voiceRequirement =
      client.staffConfig.duty.active_mode.requirements.voice_minutes_per_hour;
    const requireBoth =
      client.staffConfig.duty.active_mode.requirements.require_both;

    const meetsMessageReq = messageCount >= messageRequirement;
    const meetsVoiceReq = voiceMinutes >= voiceRequirement;

    const requirementsMet = requireBoth
      ? meetsMessageReq && meetsVoiceReq
      : meetsMessageReq || meetsVoiceReq;

    if (!requirementsMet) {
      const requirements = [];
      if (!meetsMessageReq)
        requirements.push(`mensajes (${messageCount}/${messageRequirement})`);
      if (!meetsVoiceReq)
        requirements.push(
          `actividad de voz (${voiceMinutes}/${voiceRequirement})`
        );

      await terminateDuty(
        userId,
        `no cumple con los requisitos de ${requirements.join(" y ")}`
      );
    }
  }

  setInterval(async () => {
    const activeStaff = await DutyLog.find({ status: "active" });
    for (const session of activeStaff) {
      const activity = await StaffActivity.findOne({ userId: session.userId });
      if (activity) {
        activity.messages_per_hour = 0;
        activity.voice_minutes_per_hour = 0;
        await activity.save();
      }
    }
  }, 60 * 60 * 1000);

  client.verificationManager = {
    terminateDuty,
    startVerificationSystem: async (userId, dutyType) => {
      if (verificationTimers.has(userId)) {
        clearTimeout(verificationTimers.get(userId));
        verificationTimers.delete(userId);
      }
      if (activityTimers.has(userId)) {
        clearInterval(activityTimers.get(userId));
        activityTimers.delete(userId);
      }
      pendingVerifications.delete(userId);

      if (dutyType === "active") {
        const activityTimer = setInterval(
          () => checkActivityRequirements(userId),
          60 * 60 * 1000
        );
        activityTimers.set(userId, activityTimer);
      } else if (dutyType === "invisible") {
        await scheduleNextVerification(userId);
      }
    },
    stopVerificationSystem: (userId) => {
      if (verificationTimers.has(userId)) {
        clearTimeout(verificationTimers.get(userId));
        verificationTimers.delete(userId);
      }
      if (activityTimers.has(userId)) {
        clearInterval(activityTimers.get(userId));
        activityTimers.delete(userId);
      }
      pendingVerifications.delete(userId);
    },
  };
};
