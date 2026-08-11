'use client'
import { useEffect, useRef, useState } from 'react'
import { DayPicker } from 'react-day-picker'
import { fr } from 'date-fns/locale'
import { format, parse, isValid, setYear, getYear } from 'date-fns'

interface DatePickerProps {
  value: string
  onChange: (val: string) => void
  placeholder?: string
  className?: string
}

const YEARS = Array.from({ length: 20 }, (_, i) => new Date().getFullYear() - 5 + i)

export default function DatePicker({ value, onChange, placeholder = 'JJ/MM/AAAA', className = '' }: DatePickerProps) {
  const [open, setOpen] = useState(false)
  const [showYears, setShowYears] = useState(false)
  const [month, setMonth] = useState<Date>(new Date())
  const ref = useRef<HTMLDivElement>(null)

  const selected = value ? parse(value, 'yyyy-MM-dd', new Date()) : undefined
  const displayValue = selected && isValid(selected) ? format(selected, 'dd/MM/yyyy') : ''

  useEffect(() => {
    if (selected && isValid(selected)) setMonth(selected)
  }, [value])

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false)
        setShowYears(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const handleSelect = (day: Date | undefined) => {
    if (day) {
      onChange(format(day, 'yyyy-MM-dd'))
      setOpen(false)
      setShowYears(false)
    }
  }

  const handleYearSelect = (year: number) => {
    const newMonth = setYear(month, year)
    setMonth(newMonth)
    setShowYears(false)
  }

  return (
    <div ref={ref} className={`datepicker-root ${className}`}>
      <button
        type="button"
        onClick={() => { setOpen(o => !o); setShowYears(false) }}
        className="datepicker-trigger"
      >
        <span className={displayValue ? 'datepicker-value' : 'datepicker-placeholder'}>
          {displayValue || placeholder}
        </span>
        <span className="datepicker-icon" />
      </button>

      {open && (
        <div className="datepicker-popup">
          {showYears ? (
            <div className="rdp-year-grid">
              {YEARS.map(y => (
                <button
                  key={y}
                  type="button"
                  onClick={() => handleYearSelect(y)}
                  className={`rdp-year-btn${getYear(month) === y ? ' rdp-year-active' : ''}`}
                >
                  {y}
                </button>
              ))}
            </div>
          ) : (
            <DayPicker
              mode="single"
              selected={selected && isValid(selected) ? selected : undefined}
              onSelect={handleSelect}
              locale={fr}
              month={month}
              onMonthChange={setMonth}
              classNames={{
                root:            'rdp-root',
                months:          'rdp-months',
                month:           'rdp-month',
                month_caption:   'rdp-caption',
                caption_label:   'rdp-caption-label',
                nav:             'rdp-nav',
                button_previous: 'rdp-nav-btn',
                button_next:     'rdp-nav-btn',
                weekdays:        'rdp-head-row',
                weekday:         'rdp-head-cell',
                weeks:           'rdp-tbody',
                week:            'rdp-row',
                day:             'rdp-day',
                day_button:      'rdp-day-btn',
                selected:        'rdp-day-selected',
                today:           'rdp-day-today',
                outside:         'rdp-day-outside',
                disabled:        'rdp-day-disabled',
              }}
              components={{
                CaptionLabel: ({ children }) => (
                  <button
                    type="button"
                    className="rdp-caption-label rdp-caption-label-btn"
                    onClick={() => setShowYears(true)}
                  >
                    {children} ▾
                  </button>
                ),
              }}
              footer={
                <div className="rdp-footer">
                  <button type="button" className="rdp-footer-btn" onClick={() => { onChange(''); setOpen(false) }}>Effacer</button>
                  <button type="button" className="rdp-footer-btn rdp-footer-today" onClick={() => handleSelect(new Date())}>Aujourd'hui</button>
                </div>
              }
            />
          )}
        </div>
      )}
    </div>
  )
}
