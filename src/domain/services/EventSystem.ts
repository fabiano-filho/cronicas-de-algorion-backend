import { EventCard, GameSession } from '../entities/GameSession'

export class EventService {
    private eventos: EventCard[] = [
        {
            nome: 'Fluxo Laminar',
            descricao: 'O rio do destino desliza sem cobrar o primeiro passo.',
            modificadores: { primeiroMovimentoGratisPorJogador: true }
        },
        {
            nome: 'Eco do Contrato',
            descricao:
                'O juramento reverbera: o primeiro enigma exige menos fôlego.',
            modificadores: { primeiroEnigmaDesconto: -1 }
        },
        {
            nome: 'Terreno Quebradiço',
            descricao: 'A terra cede sob os pés — cada avanço pesa mais.',
            modificadores: { moverDelta: 1 }
        },
        {
            nome: 'Atalho Efêmero',
            descricao: 'Um brilho abre caminho curto; o salto custa menos.',
            modificadores: { saltoLivreCusto: 1 }
        },
        {
            nome: 'Névoa da Dúvida',
            descricao:
                'Sussurros dissonantes enchem o ar, tornando a lógica uma jornada solitária.',
            modificadores: { discussaoEmGrupoBloqueada: true }
        }
    ]

    public iniciarRodada(session: GameSession): EventCard | null {
        const evento = this.sortearEvento(session)
        session.eventoAtivo = evento
        session.primeiroMovimentoGratisUsadoPorJogador = {}
        session.primeiroEnigmaDescontoUsado = false
        return evento
    }

    private sortearEvento(session: GameSession): EventCard | null {
        // Embaralhar o deck somente no início da partida, antes do 1º sorteio.
        if (session.rodadaAtual === 1 && session.eventoAtivo === null) {
            this.embaralhar(session.deckEventos)
        }

        // Sem reposição: quando acabar, não sorteia mais eventos na partida.
        if (session.deckEventos.length === 0) {
            return null
        }

        const eventoNome = session.deckEventos.shift() as string
        const evento =
            this.eventos.find(e => e.nome === eventoNome) ?? this.eventos[0]
        return evento
    }

    private embaralhar(deck: string[]): void {
        for (let i = deck.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1))
            ;[deck[i], deck[j]] = [deck[j], deck[i]]
        }
    }
}
