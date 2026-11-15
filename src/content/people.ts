import type { Person } from './types'

// Все, кого пилот слышит за рейс. Порядок внутри станции — порядок посадки.
export const PEOPLE: Person[] = [
  // «Синица», станция связи. В сигнале шестеро.
  { id: 'zoya', name: 'Зоя Прохорова', station: 'sinica', note: 'связистка, 31 год' },
  { id: 'nina', name: 'Нина Сергеевна Гладких', station: 'sinica', note: 'фельдшер, 52 года' },
  { id: 'kostya', name: 'Костя Ляпин', station: 'sinica', note: 'стажёр, 20 лет' },
  { id: 'gleb', name: 'Глеб Арсеньевич Лунёв', station: 'sinica', note: 'начальник станции, 61 год', aboard: false },
  { id: 'ildar', name: 'Ильдар Сафин', station: 'sinica', note: 'механик, 44 года', aboard: false },
  { id: 'vadim', name: 'Вадим Корж', station: 'sinica', note: 'оператор антенн, 38 лет', aboard: false },

  // «Тёплый Ключ», буровая на гидротермальном поле.
  { id: 'oleg', name: 'Олег Демченко', station: 'klyuch', note: 'буровой мастер, 56 лет' },
  { id: 'marat', name: 'Марат Ибрагимов', station: 'klyuch', note: 'помощник бурильщика, 24 года' },

  // «Вторая смена», рудник. Первая смена была в забое.
  { id: 'valya', name: 'Валентина Ремизова', station: 'smena', note: 'бригадир, 47 лет' },
  { id: 'ahmed', name: 'Ахмед Тагиров', station: 'smena', note: 'взрывник, 39 лет' },
  { id: 'fedya', name: 'Фёдор Кулешов', station: 'smena', note: 'проходчик, 28 лет' },
  { id: 'lyova', name: 'Лев Шмидт', station: 'smena', note: 'электрик, 33 года' },

  // «Околица», теплицы на краю пояса.
  { id: 'efim', name: 'Ефим Брусникин', station: 'okolica', note: 'агроном, 71 год' },
  { id: 'galya', name: 'Галина Брусникина', station: 'okolica', note: 'агроном, 68 лет' },

  // «Колыбель», семейная ледорезка.
  { id: 'tasya', name: 'Тася Сомова', station: 'kolybel', note: '9 лет' },
  { id: 'andrey', name: 'Андрей Сомов', station: 'kolybel', note: 'капитан ледорезки, 38 лет' },
  { id: 'lida', name: 'Лида Сомова', station: 'kolybel', note: 'штурман, 36 лет, перелом бедра' },

  // «Заря», гляциологическая практика.
  { id: 'shtern', name: 'Илья Маркович Штерн', station: 'zarya', note: 'руководитель практики, 64 года' },
  { id: 'dina', name: 'Дина Ковалёва', station: 'zarya', note: 'инженер станции, 35 лет' },
  { id: 'gena', name: 'Гена Бойко', station: 'zarya', note: 'механик-водитель, 50 лет' },
  { id: 'pasha', name: 'Паша Ершов', station: 'zarya', note: 'студент, 21 год' },
  { id: 'liza', name: 'Лиза Минц', station: 'zarya', note: 'студентка, 20 лет' },
  { id: 'sasha', name: 'Саша Квасов', station: 'zarya', note: 'студент, 22 года' },
  { id: 'ulya', name: 'Уля Ничипорук', station: 'zarya', note: 'студентка, 21 год' },

  // «Маяк-3».
  { id: 'saveliy', name: 'Савелий Игнатьевич Рябцев', station: 'mayak', note: 'смотритель, 74 года' },

  // «Полынья», артель ледорубов.
  { id: 'gosha', name: 'Гоша Ракитин', station: 'polynya', note: 'старший, 41 год' },
  { id: 'serega', name: 'Серёга Ракитин', station: 'polynya', note: 'его брат, 36 лет' },
  { id: 'lyuba', name: 'Люба Ракитина', station: 'polynya', note: 'жена Гоши, 38 лет' },
  { id: 'timur', name: 'Тимур Абдуллаев', station: 'polynya', note: 'резчик, 26 лет' },

  // «Семь Ветров», метеостанция.
  { id: 'ksenia', name: 'Ксения Орлова', station: 'vetra', note: 'начальник метеостанции, 45 лет' },
  { id: 'boris', name: 'Борис Лаптев', station: 'vetra', note: 'метеоролог, 58 лет' },
  { id: 'yan', name: 'Ян Вишневский', station: 'vetra', note: 'метеоролог, 30 лет' },
  { id: 'aglaya', name: 'Аглая Лаптева', station: 'vetra', note: 'радист, 27 лет, дочь Бориса' },

  // «Ковш», грузовой причал.
  { id: 'zahar', name: 'Захар Мельников', station: 'kovsh', note: 'начальник причала, 53 года' },
  { id: 'rita', name: 'Рита Мельникова', station: 'kovsh', note: 'диспетчер причала, 50 лет' },
  { id: 'kolya', name: 'Коля Пестов', station: 'kovsh', note: 'стропальщик, 23 года' },
  { id: 'vitya', name: 'Витя Пестов', station: 'kovsh', note: 'стропальщик, 23 года' },
  { id: 'arkadiy', name: 'Аркадий Ильич Зотов', station: 'kovsh', note: 'крановщик, 66 лет' },

  // «Артель Громова», семейный промысел.
  { id: 'stepan', name: 'Степан Ильич Громов', station: 'artel', note: 'глава артели, 67 лет' },
  { id: 'ilya', name: 'Илья Громов', station: 'artel', note: 'старший сын, 42 года' },
  { id: 'petr', name: 'Пётр Громов', station: 'artel', note: 'средний сын, 39 лет' },
  { id: 'matvey', name: 'Матвей Громов', station: 'artel', note: 'младший сын, 30 лет' },
  { id: 'olya', name: 'Оля Громова', station: 'artel', note: 'жена Ильи, 40 лет' },
  { id: 'savva', name: 'Савва Громов', station: 'artel', note: 'внук, 17 лет' },

  // «Матрёшка», жилой узел из вложенных модулей.
  { id: 'rimma', name: 'Римма Ахмадулина', station: 'matryoshka', note: 'комендант, 55 лет' },
  { id: 'grisha', name: 'Гриша Сотников', station: 'matryoshka', note: 'техник, 34 года' },
  { id: 'sveta', name: 'Света Сотникова', station: 'matryoshka', note: 'повар, 33 года' },
  { id: 'igor', name: 'Игорь Палыч Бурков', station: 'matryoshka', note: 'бухгалтер промысла, 59 лет' },
  { id: 'vanya', name: 'Ваня Кох', station: 'matryoshka', note: 'связист, 26 лет' },
  { id: 'tamara', name: 'Тамара Кох', station: 'matryoshka', note: 'мать Вани, 61 год' },

  // «Белый Яр», посёлок при шахте.
  { id: 'alla', name: 'Алла Борисовна Яковлева', station: 'yar', note: 'фельдшер посёлка, 57 лет' },
  { id: 'kuzmich', name: 'Иван Кузьмич Бельский', station: 'yar', note: 'председатель посёлка, 70 лет' },
  { id: 'dasha', name: 'Даша Бельская', station: 'yar', note: 'учительница, 29 лет' },
  { id: 'roma', name: 'Рома Сыч', station: 'yar', note: 'шахтёр, 35 лет' },
  { id: 'nastya', name: 'Настя Сыч', station: 'yar', note: 'шахтёр, 34 года' },
  { id: 'misha', name: 'Миша Корнеев', station: 'yar', note: 'шахтёр, 45 лет' },
  { id: 'tolik', name: 'Толик Корнеев', station: 'yar', note: 'шахтёр, 19 лет' },
  { id: 'vera_ya', name: 'Вера Дмитриевна Сыч', station: 'yar', note: 'пенсионерка, 81 год' },
  { id: 'zhenya', name: 'Женя Лис', station: 'yar', note: 'радист посёлка, 24 года' },

  // «Дальний Кордон», пограничный пост.
  { id: 'denis', name: 'Денис Гараев', station: 'kordon', note: 'лейтенант, начальник поста, 27 лет' },
  { id: 'ptitsyn', name: 'Коля Птицын', station: 'kordon', note: 'рядовой, 19 лет' },
]
