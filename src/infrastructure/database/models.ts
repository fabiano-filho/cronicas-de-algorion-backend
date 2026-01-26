import mongoose, { Schema } from 'mongoose'

const GameConfigSchema = new Schema({
    initial_ph: { type: Number, required: true },
    setup: {
        grid_size: { type: String, required: true },
        starting_card: { type: String, required: true },
        total_events_in_deck: { type: Number, required: true }
    },
    standard_actions: [
        {
            action: { type: String, required: true },
            cost: { type: Number, required: true }
        }
    ]
})

const HeroSchema = new Schema({
    id: { type: String, required: true, unique: true },
    name: { type: String, required: true },
    skill: { type: String, required: true },
    description: { type: String, required: true },
    unique_per_match: { type: Boolean, required: true }
})

const EventSchema = new Schema({
    id: { type: String, required: true, unique: true },
    name: { type: String, required: true },
    fluff: { type: String, required: true },
    effects: { type: Schema.Types.Mixed, required: true }
})

const HouseSchema = new Schema({
    id: { type: String, required: true, unique: true },
    name: { type: String, required: true },
    base_cost: { type: Number, required: true },
    riddle_theme: { type: String, required: true },
    tip_front_source: { type: String, default: null },
    final_riddle_lines: {
        type: Schema.Types.Mixed,
        default: null
    }
})

const FinalRiddleFragmentSchema = new Schema({
    index: { type: Number, required: true, unique: true, min: 1, max: 8 },
    variants: {
        easy: {
            text: { type: String, required: true },
            source: { type: String, required: true }
        },
        hard: {
            text: { type: String, required: true },
            source: { type: String, required: true }
        }
    }
})

const FinalChallengeSchema = new Schema({
    name: { type: String, required: true },
    description: { type: String, required: true },
    answer: { type: String, required: true },
    success_outcome: { type: String, required: true },
    failure_outcome: { type: String, required: true }
})

export const GameConfigModel = mongoose.model('GameConfig', GameConfigSchema)
export const HeroModel = mongoose.model('Hero', HeroSchema)
export const EventModel = mongoose.model('Event', EventSchema)
export const HouseModel = mongoose.model('House', HouseSchema)
export const FinalRiddleFragmentModel = mongoose.model(
    'FinalRiddleFragment',
    FinalRiddleFragmentSchema
)
export const FinalChallengeModel = mongoose.model(
    'FinalChallenge',
    FinalChallengeSchema
)
