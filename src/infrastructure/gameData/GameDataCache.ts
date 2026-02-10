import {
    EventModel,
    FinalRiddleFragmentModel,
    GameConfigModel,
    HeroModel,
    HouseChallengeModel,
    HouseModel
} from '../database/models'
import { EventCard, EventModifiers } from '../../domain/entities/GameSession'

export type TipDifficulty = 'easy' | 'hard'

export type FinalRiddleFragment = {
    index: number
    variants: {
        easy: { text: string; source: string }
        hard: { text: string; source: string }
    }
}

export type HouseChallengeType = 'charada' | 'escolha_tripla' | 'montagem'

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

export type HeroCatalogItem = {
    id: string
    tipo: 'Anao' | 'Humano' | 'Sereia' | 'Bruxa'
    nome: string
    habilidade: string
    descricao: string
}

export type HouseCatalogItem = {
    id: string
    nome: string
    ordem: number
    hasTip: boolean
}

export type ActionCosts = {
    mover: number
    explorar: number
    explorarNovamente: number
    saltoLivre: number
}

export type RuntimeGameConfig = {
    initialPh: number
    gridSize: string
    startingCardId: string
    totalEventsInDeck: number
    actionCosts: ActionCosts
}

export type RuntimeEventCard = EventCard & {
    id: string
}

type HouseTipFront = {
    houseId: string
    frontSource: string
}

const HERO_TYPE_BY_ID: Record<string, HeroCatalogItem['tipo']> = {
    anao: 'Anao',
    humano: 'Humano',
    sereia: 'Sereia',
    bruxa: 'Bruxa'
}

let fragmentsByIndex: Map<number, FinalRiddleFragment> | null = null
let houseFrontById: Map<string, HouseTipFront> | null = null
let houseCostById: Map<string, 0 | 1 | 2 | 3> | null = null
let houseChallengesByHouseId: Map<string, HouseChallenge[]> | null = null
let houseChallengeById: Map<string, HouseChallenge> | null = null
let runtimeConfig: RuntimeGameConfig | null = null
let heroCatalog: HeroCatalogItem[] | null = null
let houseCatalog: HouseCatalogItem[] | null = null
let eventDeckIds: string[] | null = null
let eventCatalog: RuntimeEventCard[] | null = null
let eventById: Map<string, RuntimeEventCard> | null = null

function assertCacheInitialized(): void {
    const ready =
        !!fragmentsByIndex &&
        !!houseFrontById &&
        !!houseCostById &&
        !!houseChallengesByHouseId &&
        !!houseChallengeById &&
        !!runtimeConfig &&
        !!heroCatalog &&
        !!houseCatalog &&
        !!eventDeckIds &&
        !!eventCatalog &&
        !!eventById

    if (!ready) {
        throw new Error(
            'GameDataCache nao inicializado. Chame initGameDataCache() no startup.'
        )
    }
}

function normalizeActionName(value: string): string {
    const normalized = (value || '').toLowerCase().trim()
    if (normalized === 'mover') return 'mover'
    if (normalized === 'explorar') return 'explorar'
    if (normalized === 'explorar novamente') return 'explorarNovamente'
    if (normalized === 'salto livre') return 'saltoLivre'
    return ''
}

function toSafeNumber(value: unknown, fallback: number): number {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : fallback
}

function mapEventEffectsToModifiers(effects: any): EventModifiers {
    const e = effects ?? {}
    const firstMoveFree = !!(
        e.first_move_free_per_player ??
        e.primeiro_movimento_gratis_por_jogador ??
        e.primeiroMovimentoGratisPorJogador
    )
    const firstRiddleDiscount = toSafeNumber(
        e.first_riddle_discount ??
            e.primeiro_enigma_desconto ??
            e.primeiroEnigmaDesconto,
        0
    )
    const moveDelta = toSafeNumber(
        e.move_cost_delta ?? e.mover_delta ?? e.moverDelta,
        0
    )
    const saltoLivreCusto = toSafeNumber(
        e.salto_livre_cost ?? e.saltoLivreCusto,
        NaN
    )
    const groupDiscussionBlocked = !!(
        e.group_discussion_blocked ??
        e.discussao_em_grupo_bloqueada ??
        e.discussaoEmGrupoBloqueada
    )

    const modifiers: EventModifiers = {}
    if (firstMoveFree) modifiers.primeiroMovimentoGratisPorJogador = true
    if (firstRiddleDiscount !== 0)
        modifiers.primeiroEnigmaDesconto = firstRiddleDiscount
    if (moveDelta !== 0) modifiers.moverDelta = moveDelta
    if (Number.isFinite(saltoLivreCusto)) modifiers.saltoLivreCusto = saltoLivreCusto
    if (groupDiscussionBlocked) modifiers.discussaoEmGrupoBloqueada = true
    return modifiers
}

function mapHeroType(heroDoc: any): HeroCatalogItem['tipo'] {
    const byId = HERO_TYPE_BY_ID[String(heroDoc?.id || '').toLowerCase()]
    if (byId) return byId

    const normalizedName = String(heroDoc?.name || '').toLowerCase()
    if (normalizedName === 'anao' || normalizedName === 'anão') return 'Anao'
    if (normalizedName === 'humano') return 'Humano'
    if (normalizedName === 'sereia') return 'Sereia'
    if (normalizedName === 'bruxa') return 'Bruxa'

    throw new Error(`GameData invalido: heroi nao suportado (${heroDoc?.id}).`)
}

export async function initGameDataCache(): Promise<void> {
    const [gameConfigs, heroes, events, fragments, houses, challenges] =
        await Promise.all([
            GameConfigModel.find({}).lean(),
            HeroModel.find({}).lean(),
            EventModel.find({}).lean(),
            FinalRiddleFragmentModel.find({}).lean(),
            HouseModel.find({}).lean(),
            HouseChallengeModel.find({}).lean()
        ])

    if ((gameConfigs as any[]).length === 0) {
        throw new Error('GameData invalido: game_config nao encontrado. Rode o seed.')
    }

    const gameConfigDoc = (gameConfigs as any[])[0]
    const actionCosts: ActionCosts = {
        mover: 1,
        explorar: 1,
        explorarNovamente: 2,
        saltoLivre: 2
    }
    const standardActions = Array.isArray(gameConfigDoc.standard_actions)
        ? gameConfigDoc.standard_actions
        : []

    for (const item of standardActions) {
        const actionName = normalizeActionName(String(item?.action || ''))
        if (!actionName) continue
        const cost = Number(item?.cost)
        if (!Number.isFinite(cost) || cost < 0) {
            throw new Error(
                `GameData invalido: custo invalido para acao "${item?.action}".`
            )
        }
        ;(actionCosts as Record<string, number>)[actionName] = cost
    }

    runtimeConfig = {
        initialPh: toSafeNumber(gameConfigDoc.initial_ph, 40),
        gridSize: String(gameConfigDoc?.setup?.grid_size || '3x3'),
        startingCardId: String(gameConfigDoc?.setup?.starting_card || 'C5'),
        totalEventsInDeck: toSafeNumber(
            gameConfigDoc?.setup?.total_events_in_deck,
            (events as any[]).length
        ),
        actionCosts
    }

    if (runtimeConfig.gridSize !== '3x3') {
        throw new Error(
            `GameData invalido: grid_size "${runtimeConfig.gridSize}" nao suportado (somente 3x3).`
        )
    }
    if (runtimeConfig.startingCardId !== 'C5') {
        throw new Error(
            `GameData invalido: starting_card "${runtimeConfig.startingCardId}" nao suportado para a regra atual (esperado C5).`
        )
    }

    heroCatalog = (heroes as any[]).map((heroDoc: any) => ({
        id: String(heroDoc.id),
        tipo: mapHeroType(heroDoc),
        nome: String(heroDoc.name || ''),
        habilidade: String(heroDoc.skill || ''),
        descricao: String(heroDoc.description || '')
    }))

    eventCatalog = (events as any[]).map((eventDoc: any) => {
        const eventId = String(eventDoc.id || '').trim()
        if (!eventId) {
            throw new Error('GameData invalido: evento sem id.')
        }
        return {
            id: eventId,
            nome: String(eventDoc.name || eventId),
            descricao: String(eventDoc.fluff || ''),
            modificadores: mapEventEffectsToModifiers(eventDoc.effects),
            backSource: `assets/cards/events/back-event-${eventId.replace(/_/g, '-')}.png`
        }
    })

    eventById = new Map(eventCatalog.map(event => [event.id, event]))
    eventDeckIds = eventCatalog.map(event => event.id)

    if (runtimeConfig.totalEventsInDeck !== eventDeckIds.length) {
        throw new Error(
            `GameData invalido: total_events_in_deck=${runtimeConfig.totalEventsInDeck} diferente da quantidade de eventos (${eventDeckIds.length}).`
        )
    }

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

    houseCostById = new Map(
        (houses as any[]).map((h: any) => {
            const cost = Number(h.base_cost)
            if (!Number.isFinite(cost) || cost < 0 || cost > 3) {
                throw new Error(
                    `GameData invalido: custo base invalido para casa ${h.id}.`
                )
            }
            return [h.id, cost as 0 | 1 | 2 | 3]
        })
    )

    houseCatalog = (houses as any[])
        .map((houseDoc: any) => {
            const houseId = String(houseDoc.id || '')
            const order = Number(houseId.replace('C', ''))
            return {
                id: houseId,
                nome: String(houseDoc.name || houseId),
                ordem: Number.isFinite(order) ? order : 0,
                hasTip: !!houseDoc.tip_front_source
            }
        })
        .sort((a, b) => a.ordem - b.ordem)

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
            `GameData invalido: esperado 8 fragmentos, encontrado ${fragmentsByIndex.size}. Rode o seed.`
        )
    }

    for (const [index, fragment] of fragmentsByIndex.entries()) {
        const eText = fragment.variants.easy.text
        const eSource = fragment.variants.easy.source
        const hText = fragment.variants.hard.text
        const hSource = fragment.variants.hard.source

        if (!eText || !eSource || !hText || !hSource) {
            throw new Error(
                `GameData invalido: fragmento ${index} com variants incompletos. Rode o seed.`
            )
        }
    }

    const houseIds = (houses as any[]).map(h => h.id)
    for (const houseId of houseIds) {
        const list = houseChallengesByHouseId.get(houseId) ?? []
        if (list.length === 0) {
            throw new Error(
                `GameData invalido: nenhum desafio configurado para a casa ${houseId}. Rode o seed.`
            )
        }
    }
}

export function getFinalRiddleFragment(
    fragmentIndex: number,
    difficulty: TipDifficulty
): { text: string; source: string } {
    assertCacheInitialized()

    const byIndex = fragmentsByIndex!
    const fragment = byIndex.get(fragmentIndex)
    if (!fragment) {
        throw new Error(`Fragmento nao encontrado: index=${fragmentIndex}`)
    }
    return fragment.variants[difficulty]
}

export function getHouseTipFrontSource(houseId: string): string {
    assertCacheInitialized()

    const byHouse = houseFrontById!
    const front = byHouse.get(houseId)
    if (!front) {
        throw new Error(
            `Frente da carta de pista nao configurada para a casa ${houseId}`
        )
    }
    return front.frontSource
}

export function getHouseBaseCost(houseId: string): 0 | 1 | 2 | 3 {
    assertCacheInitialized()

    const byHouse = houseCostById!
    const cost = byHouse.get(houseId)
    if (cost === undefined) {
        throw new Error(`Casa nao encontrada para custo base: ${houseId}`)
    }
    return cost
}

export function getHouseChallenges(houseId: string): HouseChallenge[] {
    assertCacheInitialized()
    return houseChallengesByHouseId!.get(houseId) ?? []
}

export function getHouseChallengeById(challengeId: string): HouseChallenge {
    assertCacheInitialized()

    const challenge = houseChallengeById!.get(challengeId)
    if (!challenge) {
        throw new Error(`Desafio nao encontrado: id=${challengeId}`)
    }
    return challenge
}

export function getRuntimeGameConfig(): RuntimeGameConfig {
    assertCacheInitialized()
    return runtimeConfig!
}

export function getRuntimeHeroCatalog(): HeroCatalogItem[] {
    assertCacheInitialized()
    return heroCatalog!
}

export function getRuntimeHouseCatalog(): HouseCatalogItem[] {
    assertCacheInitialized()
    return houseCatalog!
}

export function getRuntimeEventCatalog(): RuntimeEventCard[] {
    assertCacheInitialized()
    return eventCatalog!
}

export function getInitialEventDeck(): string[] {
    assertCacheInitialized()
    return [...eventDeckIds!]
}

export function getRuntimeEventById(eventId: string): RuntimeEventCard {
    assertCacheInitialized()

    const eventCard = eventById!.get(eventId)
    if (!eventCard) {
        throw new Error(`Evento nao encontrado: id=${eventId}`)
    }
    return eventCard
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
