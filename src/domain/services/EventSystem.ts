import { EventCard, GameSession } from '../entities/GameSession'

type EventResolver = (eventId: string) => EventCard

export class EventService {
    constructor(private resolveEventById: EventResolver) {}

    public iniciarRodada(session: GameSession): EventCard | null {
        const evento = this.sortearEvento(session)
        session.eventoAtivo = evento
        session.primeiroMovimentoGratisUsadoPorJogador = {}
        session.primeiroEnigmaDescontoUsado = false
        return evento
    }

    private sortearEvento(session: GameSession): EventCard | null {
        if (session.rodadaAtual === 1 && session.eventoAtivo === null) {
            this.embaralhar(session.deckEventos)
        }

        if (session.deckEventos.length === 0) {
            return null
        }

        const eventId = String(session.deckEventos.shift() || '').trim()
        if (!eventId) {
            return null
        }

        return this.resolveEventById(eventId)
    }

    private embaralhar(deck: string[]): void {
        for (let i = deck.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1))
            ;[deck[i], deck[j]] = [deck[j], deck[i]]
        }
    }
}