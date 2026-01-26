export type HeroType = 'Anao' | 'Humano' | 'Sereia' | 'Bruxa'

export interface HeroAbilityResult {
    custoEnigmaDelta?: number // negativo reduz custo
    movimentoGratis?: boolean
}

export abstract class Heroi {
    public abstract tipo: HeroType
    public abstract usarHabilidade(): HeroAbilityResult
}

export class Anao extends Heroi {
    public tipo: HeroType = 'Anao'

    public usarHabilidade(): HeroAbilityResult {
        return { custoEnigmaDelta: -1 }
    }
}

export class Humano extends Heroi {
    public tipo: HeroType = 'Humano'

    public usarHabilidade(): HeroAbilityResult {
        return { movimentoGratis: true }
    }
}

export class Sereia extends Heroi {
    public tipo: HeroType = 'Sereia'

    public usarHabilidade(): HeroAbilityResult {
        return { custoEnigmaDelta: -1 }
    }
}

export class Bruxa extends Heroi {
    public tipo: HeroType = 'Bruxa'

    public usarHabilidade(): HeroAbilityResult {
        return { custoEnigmaDelta: -1 }
    }
}
