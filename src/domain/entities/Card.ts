export type CardType = 'Local' | 'NucleoCorrompido'

export interface CardProps {
    id: string // C1 a C9
    tipo: CardType
    revelada: boolean
    custoExploracao: 0 | 1 | 2 | 3
    enigma: string
}

export class Card {
    public id: string
    public tipo: CardType
    public revelada: boolean
    public custoExploracao: 0 | 1 | 2 | 3
    public enigma: string

    constructor(props: CardProps) {
        this.id = props.id
        this.tipo = props.tipo
        this.revelada = props.revelada
        this.custoExploracao = props.custoExploracao
        this.enigma = props.enigma
    }
}
