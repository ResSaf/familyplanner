/** Client-side view of the API shapes (section 9). Kept in step with api/src/lib/types.ts by hand. */
/** `display` is the wall screen, which only sees /display. */
export type Role = 'admin' | 'member' | 'display'
export type Slot = 'breakfast' | 'lunch' | 'dinner'
export const SLOTS: Slot[] = ['breakfast', 'lunch', 'dinner']
export const CATEGORIES = ['Produce', 'Dairy', 'Bakery', 'Household', 'Other'] as const
export type Category = (typeof CATEGORIES)[number]

export interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
}

export interface Person {
  id: string
  displayName: string
  colour: string
  role: Role
}
export interface Me extends Person {
  email: string
  /** Which phone notifications this person wants (5.15). Missing for the wall. */
  notify?: NotifyChoices
}
export interface NotifyChoices {
  wash: boolean
  summary: boolean
}
/** One of my phones with notifications on (5.15). The subscription itself is never sent back (S35). */
export interface PushDevice {
  id: string
  label: string
  createdAt: string
}
/** A paired wall display (S34). Keys are never sent back after creation. */
export interface DisplayDevice {
  id: string
  name: string
  active: boolean
  createdAt: string
  createdBy: string
  lastSeenAt: string | null
}

export interface MemberRecord extends Person {
  email: string
  active: boolean
  lastLoginAt?: string
}

export interface ExternalCalendar {
  label: string
  colour: string
}
/** An event from a connected Google calendar. Google is the only source of events, so these are read-only. */
export interface Occurrence {
  id: string
  title: string
  allDay: boolean
  /** A date if allDay, else a UTC instant. */
  start: string
  end: string
  location?: string
  occurrenceDate: string
  recurring: boolean
  external: ExternalCalendar
}
export interface ExternalEvents {
  calendars: ExternalCalendar[]
  events: Occurrence[]
  unavailable: boolean
}

export interface List {
  id: string
  name: string
  uncheckedCount: number
  recentNames: string[]
}
/** The wall's shopping panel: the default list's unchecked items. */
export interface Shopping {
  id: string
  name: string
  items: { id: string; name: string; note?: string; category?: Category }[]
}
/** The wall's Lists page: an open list and its unchecked items. */
export interface WallList {
  id: string
  name: string
  isDefault: boolean
  items: Shopping['items']
}
export interface Item {
  id: string
  listId: string
  name: string
  note?: string
  category?: Category
  checked: boolean
  createdBy: string
}

export interface Task {
  id: string
  title: string
  dueDate?: string | null
  assignee?: string | null
  notes?: string
  done: boolean
  completedAt?: string | null
  createdBy: string
}

export interface PlanEntry {
  id: string
  date: string
  slot: Slot
  text: string
}
/** Ingredients, method and notes are plain text, one entry per line. A line ending in a colon is a subheading. */
export interface RecipeInput {
  title: string
  summary?: string
  serves?: string
  time?: string
  source?: string
  tags: string[]
  ingredients: string
  method: string
  notes: string
}
export interface Recipe extends RecipeInput {
  id: string
}

/** A family note: neighbours, appliances, where a manual is. The body is plain text. */
export interface NoteInput {
  title: string
  category?: string
  body: string
}
export interface Note extends NoteInput {
  id: string
  updatedAt: string
  /** Set when the note has a photo, fetched on its own by useNotePhoto. */
  photoId?: string
}

/** A stored document: photos with a title and description to find them by. Pages are fetched one at a time. */
export interface FamilyDocument {
  id: string
  title: string
  description: string
  pageIds: string[]
  thumb?: string
  createdAt: string
  createdBy: string
}
export type ImageType = 'image/jpeg' | 'image/png' | 'image/webp'
export interface DocPageImage {
  contentType: ImageType
  data: string
}

export interface Chore {
  id: string
  name: string
  /** Comes round every this many weeks (R1). Missing or 1 means weekly. */
  everyWeeks?: number
  /** A Monday on which it is due, when it isn't weekly. */
  fromWeek?: string
  /** On a chore not due in the week asked for: the next week it is. */
  nextWeek?: string
}
export interface ChoreRepeat {
  everyWeeks: number
  fromWeek?: string
}
export interface ChoreAssignment {
  choreId: string
  memberId: string
}
export interface ChoreSchedule {
  chores: Chore[]
  assignments: ChoreAssignment[]
  /** Chores that don't come round in this week, for the Chores page to list and edit. */
  notDue?: Chore[]
}

export interface WeatherDay {
  date: string
  code: number
  high: number
  low: number
  rainChance: number | null
}
/** Forecast is null when the service can't be reached. */
export interface Weather {
  place: string
  forecast: { current: { temperature: number; code: number; isDay: boolean }; days: WeatherDay[] } | null
}

export interface Settings {
  breakfastEnabled: boolean
  defaultListId?: string
}

/** What can go in the washer-dryer (5.14). The same list as the API's. */
export const LOADS = ['Lights', 'Darks', 'Colours', 'Whites', 'Towels', 'Bedding', 'Delicates', 'Mixed'] as const
export type Load = (typeof LOADS)[number]
/** Wash, wash then dry in one go, or only dry. */
export const PROGRAMMES = ['wash', 'wash-dry', 'dry'] as const
export type Programme = (typeof PROGRAMMES)[number]
export interface Wash {
  /** The kind of clothes, or null when not said: only the length is needed. */
  load: Load | null
  programme: Programme
  minutes: number
  startsAt: string
  endsAt: string
  startedBy: string
}
export interface WashState {
  wash: Wash | null
  usual: Partial<Record<Load, { minutes: number; programme: Programme }>>
  /** The server's clock when it answered. */
  now: string
}
export interface WashStart {
  load: Load | null
  programme: Programme
  minutes: number
  delayMinutes: number
}
