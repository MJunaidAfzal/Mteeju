import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react'
import { Check, ChevronDown, Loader2, Search } from 'lucide-react'

export interface ComboOption {
  value: string
  label: string
  sub?: string
  icon?: ReactNode
}

interface ComboboxProps {
  label: string
  options: ComboOption[]
  value: string
  onChange: (value: string) => void
  placeholder: string
  /** Shown for the selected value in the closed control */
  display?: { label: string; sub?: string; icon?: ReactNode } | null
  /** Options always shown first, not filtered (e.g. "All cities") */
  pinned?: ComboOption[]
  /** Offer "Use “typed text”" when nothing matches exactly */
  onCustom?: (text: string) => void
  loading?: boolean
  disabled?: boolean
  emptyText?: string
}

const MAX_SHOWN = 80

export default function Combobox({
  label,
  options,
  value,
  onChange,
  placeholder,
  display,
  pinned = [],
  onCustom,
  loading,
  disabled,
  emptyText = 'No matches',
}: ComboboxProps) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [active, setActive] = useState(0)
  const rootRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLUListElement>(null)
  const id = useId()

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return options.slice(0, MAX_SHOWN)
    // Names that start with the text first, then ones that contain it
    const starts: ComboOption[] = []
    const contains: ComboOption[] = []
    for (const o of options) {
      const name = o.label.toLowerCase()
      if (name.startsWith(q)) starts.push(o)
      else if (name.includes(q) || o.sub?.toLowerCase().includes(q)) contains.push(o)
      if (starts.length >= MAX_SHOWN) break
    }
    return [...starts, ...contains].slice(0, MAX_SHOWN)
  }, [options, search])

  const custom = onCustom && search.trim() && !filtered.some((o) => o.label.toLowerCase() === search.trim().toLowerCase()) ? search.trim() : ''
  const items: (ComboOption & { custom?: boolean })[] = [
    ...(search.trim() ? [] : pinned),
    ...filtered,
    ...(custom ? [{ value: `custom:${custom}`, label: `Use “${custom}”`, sub: 'Search this place as typed', custom: true }] : []),
  ]

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-index="${active}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [active])

  function openList() {
    if (disabled) return
    setSearch('')
    setActive(0)
    setOpen(true)
    window.setTimeout(() => inputRef.current?.focus(), 0)
  }

  function choose(item: ComboOption & { custom?: boolean }) {
    if (item.custom && onCustom) onCustom(item.value.slice('custom:'.length))
    else onChange(item.value)
    setOpen(false)
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActive((i) => Math.min(i + 1, items.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActive((i) => Math.max(i - 1, 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      if (items[active]) choose(items[active])
    } else if (e.key === 'Escape') {
      setOpen(false)
    }
  }

  return (
    <div className="combo" ref={rootRef}>
      <span className="combo__label" id={`${id}-label`}>
        {label}
      </span>
      <button
        type="button"
        className={`combo__control${open ? ' is-open' : ''}`}
        onClick={() => (open ? setOpen(false) : openList())}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-labelledby={`${id}-label`}
        disabled={disabled}
      >
        {display ? (
          <>
            {display.icon}
            <span className="combo__value">
              {display.label}
              {display.sub && <small>{display.sub}</small>}
            </span>
          </>
        ) : (
          <span className="combo__placeholder">{placeholder}</span>
        )}
        {loading ? <Loader2 size={16} className="spin combo__chevron" /> : <ChevronDown size={16} className="combo__chevron" />}
      </button>

      {open && (
        <div className="combo__panel">
          <div className="combo__search">
            <Search size={15} />
            <input
              ref={inputRef}
              value={search}
              onChange={(e) => {
                setSearch(e.target.value)
                setActive(0)
              }}
              onKeyDown={onKeyDown}
              placeholder="Type to search…"
              aria-controls={`${id}-list`}
              aria-activedescendant={items[active] ? `${id}-opt-${active}` : undefined}
            />
          </div>
          <ul className="combo__list" role="listbox" id={`${id}-list`} ref={listRef} aria-labelledby={`${id}-label`}>
            {items.map((item, i) => (
              <li
                key={`${item.value}-${i}`}
                id={`${id}-opt-${i}`}
                data-index={i}
                role="option"
                aria-selected={item.value === value}
                className={`combo__option${i === active ? ' is-active' : ''}${item.custom ? ' is-custom' : ''}`}
                onMouseEnter={() => setActive(i)}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => choose(item)}
              >
                {item.icon}
                <span className="combo__text">
                  {item.label}
                  {item.sub && <small>{item.sub}</small>}
                </span>
                {item.value === value && <Check size={15} className="combo__check" />}
              </li>
            ))}
            {items.length === 0 && <li className="combo__empty">{loading ? 'Loading…' : emptyText}</li>}
          </ul>
          {!search.trim() && options.length > MAX_SHOWN && (
            <p className="combo__more">Type to search all {options.length.toLocaleString()} options</p>
          )}
        </div>
      )}
    </div>
  )
}
