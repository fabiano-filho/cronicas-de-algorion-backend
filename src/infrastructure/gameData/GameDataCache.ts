import { FinalRiddleFragmentModel, HouseModel } from '../database/models'

export type TipDifficulty = 'easy' | 'hard'

export type FinalRiddleFragment = {
    index: number
    variants: {
        easy: { text: string; source: string }
        hard: { text: string; source: string }
    }
}

type HouseTipFront = {
    houseId: string
    frontSource: string
}

let fragmentsByIndex: Map<number, FinalRiddleFragment> | null = null
let houseFrontById: Map<string, HouseTipFront> | null = null

export async function initGameDataCache(): Promise<void> {
    const [fragments, houses] = await Promise.all([
        FinalRiddleFragmentModel.find({}).lean(),
        HouseModel.find({}).lean()
    ])

    fragmentsByIndex = new Map(
        fragments.map((f: any) => [
            f.index,
            {
                index: f.index,
                variants: {
                    easy: {
                        text: f.variants?.easy?.text,
                        source: f.variants?.easy?.source
                    },
                    hard: {
                        text: f.variants?.hard?.text,
                        source: f.variants?.hard?.source
                    }
                }
            }
        ])
    )

    houseFrontById = new Map(
        houses
            .filter(h => !!h.tip_front_source)
            .map(h => [
                h.id,
                {
                    houseId: h.id,
                    frontSource: h.tip_front_source as string
                }
            ])
    )

    if (fragmentsByIndex.size !== 8) {
        throw new Error(
            `GameData inválido: esperado 8 fragmentos, encontrado ${fragmentsByIndex.size}. Rode o seed.`
        )
    }

    for (const [index, fragment] of fragmentsByIndex.entries()) {
        const eText = fragment.variants.easy.text
        const eSource = fragment.variants.easy.source
        const hText = fragment.variants.hard.text
        const hSource = fragment.variants.hard.source

        if (!eText || !eSource || !hText || !hSource) {
            throw new Error(
                `GameData inválido: fragmento ${index} com variants incompletos. Rode o seed.`
            )
        }
    }
}

export function getFinalRiddleFragment(
    fragmentIndex: number,
    difficulty: TipDifficulty
): { text: string; source: string } {
    if (!fragmentsByIndex) {
        throw new Error(
            'GameDataCache não inicializado. Chame initGameDataCache() no startup.'
        )
    }
    const fragment = fragmentsByIndex.get(fragmentIndex)
    if (!fragment) {
        throw new Error(`Fragmento não encontrado: index=${fragmentIndex}`)
    }
    return fragment.variants[difficulty]
}

export function getHouseTipFrontSource(houseId: string): string {
    if (!houseFrontById) {
        throw new Error(
            'GameDataCache não inicializado. Chame initGameDataCache() no startup.'
        )
    }
    const front = houseFrontById.get(houseId)
    if (!front) {
        throw new Error(
            `Frente da carta de pista não configurada para a casa ${houseId}`
        )
    }
    return front.frontSource
}
