import { GameSession } from '../../domain/entities/GameSession'
import { GameSessionModel } from '../database/GameSessionModel'

const sessions = new Map<string, GameSession>()
const masterBySession = new Map<string, string>()
const pendingPersistTimers = new Map<string, NodeJS.Timeout>()

const PERSIST_DEBOUNCE_MS = 75

function buildDefaultFinalSlots() {
    return Array.from({ length: 8 }, (_, slotIndex) => ({
        slotIndex,
        cardId: null
    }))
}

function toSessionSnapshotDoc(raw: any): any {
    if (!raw) return null

    // Compatibilidade com formato antigo sem wrapper "snapshot"
    if (raw.snapshot && typeof raw.snapshot === 'object') {
        return raw.snapshot
    }

    const { _id, __v, createdAt, updatedAt, ...legacy } = raw
    if (legacy && typeof legacy === 'object' && legacy.id) {
        return legacy
    }

    return null
}

function normalizeSession(raw: any): GameSession | null {
    if (!raw || typeof raw !== 'object' || !raw.id) {
        return null
    }

    const isRecord = (value: unknown): value is Record<string, unknown> =>
        !!value && typeof value === 'object' && !Array.isArray(value)

    if (
        !Array.isArray(raw.slotsEnigmaFinal) ||
        raw.slotsEnigmaFinal.length !== 8
    ) {
        raw.slotsEnigmaFinal = buildDefaultFinalSlots()
    }
    if (!Array.isArray(raw.deckPistas)) {
        raw.deckPistas = []
    }
    if (!isRecord(raw.puzzleDeck)) {
        raw.puzzleDeck = { drawPile: [], assignedByHouse: {} }
    }
    if (!Array.isArray(raw.puzzleDeck.drawPile)) {
        raw.puzzleDeck.drawPile = []
    }
    if (!isRecord(raw.puzzleDeck.assignedByHouse)) {
        raw.puzzleDeck.assignedByHouse = {}
    }
    if (!isRecord(raw.registrosEnigmas)) {
        raw.registrosEnigmas = {}
    }
    if (!isRecord(raw.desafioSelecionadoPorCasa)) {
        raw.desafioSelecionadoPorCasa = {}
    }
    if (!isRecord(raw.enigmasExibidos)) {
        raw.enigmasExibidos = {}
    }
    if (!isRecord(raw.inventarioPistas)) {
        raw.inventarioPistas = { easy: [], hard: [] }
    }
    if (!Array.isArray(raw.inventarioPistas.easy)) {
        raw.inventarioPistas.easy = []
    }
    if (!Array.isArray(raw.inventarioPistas.hard)) {
        raw.inventarioPistas.hard = []
    }
    if (!isRecord(raw.primeiroMovimentoGratisUsadoPorJogador)) {
        raw.primeiroMovimentoGratisUsadoPorJogador = {}
    }
    if (!isRecord(raw.movimentoGratisHeroiPorJogador)) {
        raw.movimentoGratisHeroiPorJogador = {}
    }
    if (!isRecord(raw.descontoEnigmaHeroiPorJogador)) {
        raw.descontoEnigmaHeroiPorJogador = {}
    }
    if (!isRecord(raw.habilidadesUsadasPorJogador)) {
        raw.habilidadesUsadasPorJogador = {}
    }

    // Runtime uses plain data shape, no class reconstruction needed.
    return raw as GameSession
}

async function persistSessionNow(sessionId: string): Promise<void> {
    const session = sessions.get(sessionId)
    if (!session) {
        return
    }
    const mestreId = masterBySession.get(sessionId) ?? null

    await GameSessionModel.updateOne(
        { id: sessionId },
        { $set: { snapshot: session, mestreId } },
        { upsert: true }
    )
}

function schedulePersist(sessionId: string): void {
    const existing = pendingPersistTimers.get(sessionId)
    if (existing) {
        clearTimeout(existing)
    }

    const timer = setTimeout(() => {
        pendingPersistTimers.delete(sessionId)
        void persistSessionNow(sessionId).catch(error => {
            console.error(
                `[sessionStore] Erro ao persistir sessao ${sessionId}:`,
                error
            )
        })
    }, PERSIST_DEBOUNCE_MS)

    pendingPersistTimers.set(sessionId, timer)
}

export async function initSessionStore(): Promise<void> {
    const docs = await GameSessionModel.find({}).lean()
    sessions.clear()
    masterBySession.clear()

    for (const doc of docs) {
        const raw = toSessionSnapshotDoc(doc)
        const session = normalizeSession(raw)
        if (!session?.id) continue
        sessions.set(session.id, session)
        if (typeof doc.mestreId === 'string' && doc.mestreId.trim()) {
            masterBySession.set(session.id, doc.mestreId)
        }
    }

    console.log(`[sessionStore] Sessoes reidratadas: ${sessions.size}`)
}

export function getSession(sessionId: string): GameSession | undefined {
    return sessions.get(sessionId)
}

export function saveSession(session: GameSession): void {
    sessions.set(session.id, session)
    schedulePersist(session.id)
}

export function getSessionMasterId(sessionId: string): string | undefined {
    return masterBySession.get(sessionId)
}

export function setSessionMasterId(sessionId: string, mestreId: string): void {
    if (!mestreId?.trim()) return
    masterBySession.set(sessionId, mestreId)
    if (sessions.has(sessionId)) {
        schedulePersist(sessionId)
        return
    }

    void GameSessionModel.updateOne(
        { id: sessionId },
        { $set: { mestreId } },
        { upsert: false }
    ).catch(error => {
        console.error(
            `[sessionStore] Erro ao persistir mestre da sessao ${sessionId}:`,
            error
        )
    })
}

export function markSessionDirty(sessionId: string): void {
    if (!sessions.has(sessionId)) return
    schedulePersist(sessionId)
}

export function deleteSession(sessionId: string): void {
    const timer = pendingPersistTimers.get(sessionId)
    if (timer) {
        clearTimeout(timer)
        pendingPersistTimers.delete(sessionId)
    }

    sessions.delete(sessionId)
    masterBySession.delete(sessionId)

    void GameSessionModel.deleteOne({ id: sessionId }).catch(error => {
        console.error(
            `[sessionStore] Erro ao remover sessao ${sessionId} do banco:`,
            error
        )
    })
}

export async function flushSessionStorePersistence(): Promise<void> {
    const pendingIds = Array.from(pendingPersistTimers.keys())
    for (const sessionId of pendingIds) {
        const timer = pendingPersistTimers.get(sessionId)
        if (timer) {
            clearTimeout(timer)
            pendingPersistTimers.delete(sessionId)
        }
        await persistSessionNow(sessionId)
    }
}
