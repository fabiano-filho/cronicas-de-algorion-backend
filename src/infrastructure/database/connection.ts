import mongoose from 'mongoose'

export async function connectDatabase(uri: string): Promise<void> {
    await mongoose.connect(uri, {
        serverSelectionTimeoutMS: 8000,
        connectTimeoutMS: 8000
    })
}
