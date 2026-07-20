import { useEffect, useMemo, useState } from 'react'
import { LANGUAGE_STORAGE_KEY, loadLanguage, makeTranslator, type Language } from '@/lib/i18n'

/** Active UI language, its translator, and persistence to localStorage. */
export function useLanguage() {
  const [lang, setLang] = useState<Language>(loadLanguage)
  const t = useMemo(() => makeTranslator(lang), [lang])

  useEffect(() => {
    localStorage.setItem(LANGUAGE_STORAGE_KEY, lang)
  }, [lang])

  return { lang, setLang, t }
}
