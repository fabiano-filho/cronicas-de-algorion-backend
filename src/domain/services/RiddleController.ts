import { GameSession } from '../entities/GameSession'
import { ActionManager } from './ActionManager'

export type RiddleQuality = 'otima' | 'ruim'

export class RiddleController {
    private casas: Record<string, { nome: string; custoPH: 0 | 1 | 2 | 3 }> = {
        C1: {
            nome: 'Biblioteca dos Mil Mestres',
            custoPH: 2
        },
        C2: {
            nome: 'Masmorra do Dragão',
            custoPH: 1
        },
        C3: {
            nome: 'Jardim das Sementes-Mãe',
            custoPH: 1
        },
        C4: {
            nome: 'Mercado das Mil Vozes',
            custoPH: 2
        },
        C5: {
            nome: 'Bosque dos Ramos Rebeldes',
            custoPH: 0
        },
        C6: {
            nome: 'Arena dos Homens-Peixe',
            custoPH: 3
        },
        C7: {
            nome: 'Deserto do Decreto Final',
            custoPH: 1
        },
        C8: {
            nome: 'Castelo Flutuante',
            custoPH: 3
        },
        C9: {
            nome: 'Montanha da Perdição',
            custoPH: 1
        }
    }

    constructor(private actionManager: ActionManager) {}

    public getCustoPH(casaId: string): 0 | 1 | 2 | 3 {
        const casa = this.casas[casaId]
        return (casa?.custoPH ?? 1) as 0 | 1 | 2 | 3
    }

    public registrarResposta(
        session: GameSession,
        input: {
            casaId: string
            jogadorId?: string
        }
    ): void {
        const casa = this.casas[input.casaId]
        const custoPH = casa?.custoPH ?? 1

        session.riddlePendente = {
            casaId: input.casaId,
            custoPH: custoPH as 0 | 1 | 2 | 3,
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

        return { casaId }
    }
}
