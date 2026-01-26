const { io } = require('socket.io-client')

const SERVER_URL = 'http://127.0.0.1:3001'

function waitForEvent(socket, eventName, predicate, timeoutMs = 7000) {
    return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
            cleanup()
            reject(new Error(`Timeout aguardando evento: ${eventName}`))
        }, timeoutMs)

        const handler = payload => {
            try {
                if (!predicate || predicate(payload)) {
                    cleanup()
                    resolve(payload)
                }
            } catch (err) {
                cleanup()
                reject(err)
            }
        }

        function cleanup() {
            clearTimeout(timeout)
            socket.off(eventName, handler)
        }

        socket.on(eventName, handler)
    })
}

async function main() {
    const sessionId = `smoke_${Date.now()}`
    const mestreId = 'mestre_smoke'
    const jogadorId = 'jogador_smoke'

    const socket = io(SERVER_URL, {
        timeout: 7000,
        reconnectionAttempts: 3
    })

    let connectErrors = 0
    socket.on('connect_error', err => {
        connectErrors++
        if (connectErrors <= 3) {
            console.error('connect_error:', err?.message || err)
        }
    })

    socket.on('acao_negada', data => {
        console.error('acao_negada:', data)
        process.exitCode = 1
    })

    await waitForEvent(socket, 'connect', () => true, 7000)

    // 1) Criar/iniciar sessão
    socket.emit('iniciar_sessao', { sessionId, mestreId })
    await waitForEvent(
        socket,
        'estado_atualizado',
        s => s && s.id === sessionId,
        7000
    )

    // 2) Entrar/selecionar herói
    socket.emit('escolher_heroi', {
        sessionId,
        jogadorId,
        nome: 'Tester',
        heroiTipo: 'Humano'
    })
    await waitForEvent(
        socket,
        'lobby_atualizado',
        payload =>
            Array.isArray(payload?.jogadores) &&
            payload.jogadores.some(j => j.id === jogadorId),
        7000
    )

    // 3) Registrar resposta de enigma e confirmar (gera pista)
    socket.emit('responder_enigma', {
        sessionId,
        jogadorId,
        texto: 'resposta-teste',
        casaId: 'C1'
    })
    await waitForEvent(
        socket,
        'enigma_recebido',
        payload => payload?.casaId === 'C1',
        7000
    )

    socket.emit('confirm_answer', { sessionId, jogadorId, quality: 'otima' })
    const added = await waitForEvent(
        socket,
        'carta_pista_adicionada',
        payload => payload?.carta?.id,
        7000
    )

    const cardId = added.carta.id

    // 4) Posicionar em slot e verificar broadcast
    socket.emit('posicionar_pista_slot', {
        sessionId,
        jogadorId,
        cardId,
        slotIndex: 0
    })

    await waitForEvent(
        socket,
        'slot_atualizado',
        payload => payload?.slotsEnigmaFinal?.[0]?.cardId === cardId,
        7000
    )

    // 5) Remover do slot
    socket.emit('remover_pista_slot', {
        sessionId,
        jogadorId,
        slotIndex: 0
    })

    await waitForEvent(
        socket,
        'slot_atualizado',
        payload => payload?.slotsEnigmaFinal?.[0]?.cardId === null,
        7000
    )

    console.log('SMOKE OK:', {
        sessionId,
        cardId,
        slotIndex: 0
    })

    socket.disconnect()
}

main().catch(err => {
    console.error('SMOKE FAILED:', err)
    process.exitCode = 1
})
