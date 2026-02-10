import { GameSession } from '../entities/GameSession'
import { ActionManager } from './ActionManager'

export type RiddleQuality = 'otima' | 'ruim'
type HouseCostResolver = (houseId: string) => 0 | 1 | 2 | 3

export class RiddleController {
    constructor(
        private actionManager: ActionManager,
        private resolveHouseCost: HouseCostResolver = () => 1
    ) {}

    public getCustoPH(casaId: string): 0 | 1 | 2 | 3 {
        return this.resolveHouseCost(casaId)
    }

    public registrarResposta(
        session: GameSession,
        input: {
            casaId: string
            jogadorId?: string
        }
    ): void {
        const custoPH = this.getCustoPH(input.casaId)

        session.riddlePendente = {
            casaId: input.casaId,
            custoPH,
            jogadorId: input.jogadorId
        }
    }

    public confirmarResposta(
        session: GameSession,
        quality: RiddleQuality
    ): { casaId: string } {
        if (!session.riddlePendente) {
            throw new Error('Nenhuma resposta pendente')
        }
        const casaId = session.riddlePendente.casaId
        session.riddlePendente = null
        void quality
        return { casaId }
    }
}
