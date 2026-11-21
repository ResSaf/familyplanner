/** `display` is the wall screen: it may only read what the dashboard shows (section 4). */
export type Role = 'admin' | 'member' | 'display'
export type DocType = 'member' | 'event' | 'list' | 'item' | 'task' | 'meal' | 'plan' | 'settings' | 'recipe' | 'chore' | 'choreWeek' | 'displayDevice' | 'note' | 'notePhoto' | 'document' | 'docPage' | 'wash'
export type Slot = 'breakfast' | 'lunch' | 'dinner'
export const SLOTS: Slot[] = ['breakfast', 'lunch', 'dinner']
export const CATEGORIES = ['Produce', 'Dairy', 'Bakery', 'Household', 'Other'] as const
export type Category = (typeof CATEGORIES)[number]

export interface BaseDoc {
  id: string
  familyId: string
  type: DocType
  createdAt: string
  createdBy: string
  updatedAt: string
  updatedBy: string
}

export interface Member extends BaseDoc {
  type: 'member'
  displayName: string
  email: string
  role: Role
  colour: string
  lastLoginAt?: string
  active: boolean
  providerUserId?: string
}

export interface List extends BaseDoc {
  type: 'list'
  name: string
  sortOrder: number
  archived: boolean
  recentNames: string[]
}

export interface Item extends BaseDoc {
  type: 'item'
  listId: string
  name: string
  note?: string
  category?: Category
  checked: boolean
  checkedAt?: string
  checkedBy?: string
}

export interface Task extends BaseDoc {
  type: 'task'
  title: string
  dueDate?: string | null
  assignee?: string | null
  notes?: string
  done: boolean
  completedAt?: string | null
  completedBy?: string | null
}

/** Left over from the removed meal library. Read only, so older plan cells keep their names. */
export interface Meal extends BaseDoc {
  type: 'meal'
  name: string
}

export interface PlanEntry extends BaseDoc {
  type: 'plan'
  date: string
  slot: Slot
  text?: string
  /** Older cells only. New cells always hold text. */
  mealId?: string
}

/** Ingredients, method and notes are plain text, one entry per line. A line ending in a colon is a subheading. */
export interface Recipe extends BaseDoc {
  type: 'recipe'
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

export interface Chore extends BaseDoc {
  type: 'chore'
  name: string
  /** Comes round every this many weeks (R1). Missing means weekly. */
  everyWeeks?: number
  /** A Monday on which it is due; with `everyWeeks`, fixes which weeks those are. */
  fromWeek?: string
}

/** Who has a chore in one week. At most one per chore per week, because the id is built from both. */
export interface ChoreWeek extends BaseDoc {
  type: 'choreWeek'
  /** The Monday. */
  week: string
  choreId: string
  memberId: string
}

export interface Settings extends BaseDoc {
  type: 'settings'
  id: 'settings'
  breakfastEnabled: boolean
  defaultListId?: string
}

/**
 * A paired wall display (S34). Only the SHA-256 of its key is stored; the key itself
 * lives in the display's cookie. Revoking clears the hash, so the record stays for the audit trail.
 */
export interface DisplayDevice extends BaseDoc {
  type: 'displayDevice'
  name: string
  keyHash: string
  active: boolean
  lastSeenAt?: string
}

/**
 * A family note: something the household wants to hand, such as the neighbours' names or where an appliance's
 * manual is. The body is plain text. The category groups notes ("Neighbours", "Appliances") and is free text.
 */
export interface Note extends BaseDoc {
  type: 'note'
  title: string
  category?: string
  body: string
  /** The note's one photo, such as an appliance's programme chart: a `notePhoto` record, so the list stays small. */
  photoId?: string
}

/** A note's photo, base64, read only through its note. The wall shows it, so it is never a private document. */
export interface NotePhoto extends BaseDoc {
  type: 'notePhoto'
  noteId: string
  contentType: ImageType
  data: string
}

/**
 * A stored document: photos of a letter, a warranty, a manual. The title and description are what the
 * family and the chat assistant search, because the photos themselves aren't read. Each page is its own
 * `docPage` record, listed here in order, so the list of documents never carries the photos.
 */
export interface FamilyDocument extends BaseDoc {
  type: 'document'
  title: string
  description: string
  pageIds: string[]
  /** A small JPEG of the first page, base64, for the list. */
  thumb?: string
}

/** One page of a document: an image, base64, read only through its document. */
export interface DocPage extends BaseDoc {
  type: 'docPage'
  documentId: string
  contentType: ImageType
  data: string
}

/** What's in the washing machine, as the wall and app offer it (5.14). A fixed list, so the wall key never sends free text. */
export const LOADS = ['Lights', 'Darks', 'Colours', 'Whites', 'Towels', 'Bedding', 'Delicates', 'Mixed'] as const
export type Load = (typeof LOADS)[number]
/** The washer-dryer's programmes: wash, wash then dry in one go, or only dry. */
export const PROGRAMMES = ['wash', 'wash-dry', 'dry'] as const
export type Programme = (typeof PROGRAMMES)[number]

/**
 * The washer-dryer (5.14): one machine, so one record, id `wash`. Starting a wash replaces the last one.
 * Emptying keeps the record, so each load's usual length is remembered.
 * There is always a load in the machine; only its length is needed. What kind of clothes it is, and whether it is
 * washed, washed and dried or only dried, are extras. Records from before the programme had
 * `dry: boolean` instead, read as wash or wash & dry.
 */
export interface Wash extends BaseDoc {
  type: 'wash'
  id: 'wash'
  /** The kind of clothes, or null when not said. */
  load: Load | null
  /** Only a label: `minutes` is the whole programme. */
  programme: Programme
  minutes: number
  /** Later than createdAt when the machine's delay start was used. */
  startsAt: string
  endsAt: string
  startedBy: string
  emptiedAt: string | null
  emptiedBy: string | null
  /** Each load's last length and programme, offered first next time. */
  usual: Partial<Record<Load, { minutes: number; programme: Programme }>>
}

export const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const
export type ImageType = (typeof IMAGE_TYPES)[number]

export type AnyDoc = Member | List | Item | Task | Meal | PlanEntry | Recipe | Chore | ChoreWeek | Settings | DisplayDevice | Note | NotePhoto | FamilyDocument | DocPage | Wash

export interface Caller {
  memberId: string
  role: Role
  familyId: string
  displayName: string
}
