import {
    FinalRiddleFragmentModel,
    HouseChallengeModel,
    HouseModel
} from '../database/models'

export type TipDifficulty = 'easy' | 'hard'

export type FinalRiddleFragment = {
    index: number
    variants: {
        easy: { text: string; source: string }
        hard: { text: string; source: string }
    }
}

export type HouseChallengeType = 'charada' | 'escolha_tripla' | 'codigo'

export type HouseChallengeOption = {
    id: string
    text: string
}

export type HouseChallengePublic = {
    id: string
    houseId: string
    type: HouseChallengeType
    lore: string
    prompt: string
    options: HouseChallengeOption[]
}

export type HouseChallenge = HouseChallengePublic & {
    correctOptionId: string | null
    answer: string | null
}

type HouseTipFront = {
    houseId: string
    frontSource: string
}

let fragmentsByIndex: Map<number, FinalRiddleFragment> | null = null
let houseFrontById: Map<string, HouseTipFront> | null = null
let houseChallengesByHouseId: Map<string, HouseChallenge[]> | null = null
let houseChallengeById: Map<string, HouseChallenge> | null = null

export async function initGameDataCache(): Promise<void> {
    const [fragments, houses, challenges] = await Promise.all([
        FinalRiddleFragmentModel.find({}).lean(),
        HouseModel.find({}).lean(),
        HouseChallengeModel.find({}).lean()
    ])

    fragmentsByIndex = new Map(
        (fragments as any[]).map((f: any) => [
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
        (houses as any[])
            .filter((h: any) => !!h.tip_front_source)
            .map((h: any) => [
                h.id,
                {
                    houseId: h.id,
                    frontSource: h.tip_front_source as string
                }
            ])
    )

    const mappedChallenges: HouseChallenge[] = (challenges as any[]).map(
        (c: any) => ({
            id: c.id,
            houseId: c.house_id,
            type: c.type,
            lore: c.lore,
            prompt: c.prompt,
            options: Array.isArray(c.options)
                ? c.options.map((o: any) => ({ id: o.id, text: o.text }))
                : [],
            correctOptionId: c.correct_option_id ?? null,
            answer: c.answer ?? null
        })
    )

    houseChallengeById = new Map(mappedChallenges.map(c => [c.id, c]))
    houseChallengesByHouseId = new Map()
    for (const c of mappedChallenges) {
        const list = houseChallengesByHouseId.get(c.houseId) ?? []
        list.push(c)
        houseChallengesByHouseId.set(c.houseId, list)
    }

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

    const houseIds = (houses as any[]).map(h => h.id)
    for (const houseId of houseIds) {
        const list = houseChallengesByHouseId.get(houseId) ?? []
        if (list.length === 0) {
            throw new Error(
                `GameData inválido: nenhum desafio configurado para a casa ${houseId}. Rode o seed.`
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

export function getHouseChallenges(houseId: string): HouseChallenge[] {
    if (!houseChallengesByHouseId) {
        throw new Error(
            'GameDataCache não inicializado. Chame initGameDataCache() no startup.'
        )
    }
    return houseChallengesByHouseId.get(houseId) ?? []
}

export function getHouseChallengeById(challengeId: string): HouseChallenge {
    if (!houseChallengeById) {
        throw new Error(
            'GameDataCache não inicializado. Chame initGameDataCache() no startup.'
        )
    }
    const challenge = houseChallengeById.get(challengeId)
    if (!challenge) {
        throw new Error(`Desafio não encontrado: id=${challengeId}`)
    }
    return challenge
}

export function toPublicHouseChallenge(
    challenge: HouseChallenge
): HouseChallengePublic {
    return {
        id: challenge.id,
        houseId: challenge.houseId,
        type: challenge.type,
        lore: challenge.lore,
        prompt: challenge.prompt,
        options: challenge.options
    }
}

