import { Heroi, HeroType } from './Hero'

export interface PlayerProps {
    id: string
    nome: string
    hero: Heroi
    posicao: string // id da carta no tabuleiro
}

export class Player {
    public id: string
    public nome: string
    public hero: Heroi
    public posicao: string

    constructor(props: PlayerProps) {
        this.id = props.id
        this.nome = props.nome
        this.hero = props.hero
        this.posicao = props.posicao
    }

    public get heroType(): HeroType {
        return this.hero.tipo
    }
}
