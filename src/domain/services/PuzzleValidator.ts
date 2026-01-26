import { GameSession } from '../entities/GameSession'

export type QualidadeResposta = 'SucessoOtimo' | 'Bom' | 'Ruim'

export class PuzzleValidator {
    public registrarQualidade(
        session: GameSession,
        playerId: string,
        qualidade: QualidadeResposta
    ): GameSession {
        session.registrosEnigmas[playerId] = qualidade
        return session
    }
}
