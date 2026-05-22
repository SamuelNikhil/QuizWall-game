# Game Plugin Architecture

The room/session system is now fully decoupled from game-specific logic. You can add new games as plugins without modifying the core infrastructure.

---

## Core Concepts

### 1. `GameEngine` Interface
All games implement this interface (`server/src/domain/GameEngine.ts`):

```ts
interface GameEngine {
    getSessionId(): string;
    initialize(options?: unknown): Promise<void>;
    isReady(): boolean;
    reset(silent?: boolean): void;
    destroy(): void;
    getQuestionsAnswered(): number;
    getSessionQuestionsAnswered(): number;
    getResyncState?(): Record<string, unknown> | undefined;
}
```

### 2. `GameRegistry`
Maps game type strings to their engine constructors (`server/src/domain/GameRegistry.ts`).

Built-in games are registered automatically:
```ts
registry.set('shootquiz', QuizEngine);
```

### 3. `Room` Structure
Rooms are now game-agnostic:

```ts
interface Room {
    roomId: string;
    gameType: GameType;  // 'shootquiz' | 'yourgame'
    engine: GameEngine;  // Generic interface, not QuizEngine
    // ...rest unchanged
}
```

---

## Adding a New Game

### Step 1: Create Your Game Engine

```ts
// server/src/domain/MyGameEngine.ts
import type { GameEngine } from './GameEngine.ts';

export class MyGameEngine implements GameEngine {
    private sessionId: string;
    
    constructor(sessionId?: string) {
        this.sessionId = sessionId || `mygame-${Date.now()}`;
    }
    
    getSessionId(): string {
        return this.sessionId;
    }
    
    async initialize(options?: unknown): Promise<void> {
        // Load your game data
    }
    
    isReady(): boolean {
        return true;
    }
    
    reset(silent?: boolean): void {
        // Reset game state
    }
    
    destroy(): void {
        // Clean up timers, resources
    }
    
    getQuestionsAnswered(): number {
        return 0; // Or your game's equivalent
    }
    
    getSessionQuestionsAnswered(): number {
        return 0;
    }
    
    // Optional: provide reconnect state
    getResyncState?(): Record<string, unknown> {
        return { myGameState: 'data' };
    }
}
```

### Step 2: Register Your Game

```ts
// server/src/index.ts or server/src/combined-server.ts
import { registerGame } from './domain/GameRegistry.ts';
import { MyGameEngine } from './domain/MyGameEngine.ts';

// Before creating rooms:
registerGame('mygame', MyGameEngine);
```

### Step 3: Update the `GameType` Union

```ts
// server/src/domain/GameEngine.ts
export type GameType = 'shootquiz' | 'mygame';
```

### Step 4: Create Game-Specific Event Handlers

```ts
// server/src/transport/myGameHandlers.ts
import type { Room } from '../domain/RoomManager.ts';
import { MyGameEngine } from '../domain/MyGameEngine.ts';

function asMyGameEngine(room: Room): MyGameEngine | null {
    return room.engine instanceof MyGameEngine ? room.engine : null;
}

export function registerMyGameHandlers(io: GeckosServer, roomManager: RoomManager) {
    io.onConnection((channel) => {
        channel.on('MY_GAME_ACTION', (data) => {
            const { roomId } = channel.userData || {};
            const room = roomManager.getRoom(roomId);
            if (!room) return;
            
            const engine = asMyGameEngine(room);
            if (!engine) return; // Not running this game
            
            // Handle your game logic
        });
    });
}
```

### Step 5: Wire Up Your Handlers

```ts
// server/src/transport/eventHandlers.ts
import { registerMyGameHandlers } from './myGameHandlers.ts';

export function registerEventHandlers(io: GeckosServer, roomManager: RoomManager): void {
    // Core room handlers (unchanged)
    // ...
    
    // Game-specific handlers
    registerMyGameHandlers(io, roomManager);
}
```

### Step 6: Create Rooms with Your Game Type

```ts
// When screen connects:
const { roomId, joinToken } = roomManager.createRoom(screenChannel, 'mygame');
```

---

## What's Game-Agnostic (Reusable)

✅ Room creation, joining, tokens  
✅ Controller connections, reconnects  
✅ Leader promotion, grace periods  
✅ Lobby state, player management  
✅ Idle reaping, cleanup  
✅ Score tracking (generic)  

## What's Game-Specific (Per-Game)

❌ Game initialization (questions, levels, etc.)  
❌ Game timers, phases, rounds  
❌ Input validation (shoot, move, etc.)  
❌ Win conditions, scoring rules  
❌ Resync state for reconnects  

---

## Example: ShootQuiz

`QuizEngine` implements `GameEngine` and handles:
- Loading questions from Groq/JSON
- Timer management (singleplayer vs multiplayer phases)
- Answer validation
- Topic voting (quiz-specific feature)

All quiz-specific event handlers (`SHOOT`, `TOPIC_VOTE`, etc.) use `asQuizEngine(room)` to safely cast `room.engine` to `QuizEngine` before accessing quiz-specific methods.

---

## Migration Notes

- **Existing code is backward-compatible** — `'shootquiz'` is the default game type
- **No client changes needed yet** — the client still connects to `/controller/:roomId/:token`
- **Future**: Add `/controller/:gameType/:roomId/:token` routing when you have multiple games

---

## Testing Your New Game

1. Register your game in `index.ts`
2. Create a room with `createRoom(channel, 'mygame')`
3. Join as a controller
4. Emit your game-specific events
5. Verify `room.engine instanceof MyGameEngine` returns `true`

The core room infrastructure (reconnects, grace periods, cleanup) works automatically.
