import { GameSession } from '../../domain/entities/GameSession'

const sessions = new Map<string, GameSession>()

export function getSession(sessionId: string): GameSession | undefined {
    return sessions.get(sessionId)
}

export function saveSession(session: GameSession): void {
    sessions.set(session.id, session)
}
