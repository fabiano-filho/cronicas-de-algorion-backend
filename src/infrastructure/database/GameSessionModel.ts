import mongoose, { Schema } from 'mongoose'

const GameSessionSchema = new Schema({
    id: { type: String, required: true, unique: true, index: true },
    mestreId: { type: String, default: null },
    snapshot: { type: Schema.Types.Mixed, required: true }
})
GameSessionSchema.set('timestamps', true)

export const GameSessionModel = mongoose.model('GameSession', GameSessionSchema)
