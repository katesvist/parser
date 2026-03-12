import { Tender } from '../types/tender';

export const mockTenders: Tender[] = [
  {
    id: 1,
    object_number: '0373100001823000001',
    href: 'https://zakupki.gov.ru/epz/order/notice/ea44/view/common-info.html?regNumber=0373100001823000001',
    zakon: '44-ФЗ',
    etap_zakupki: 'Прием заявок',
    
    object_info: 'Поставка компьютерного оборудования для государственных нужд',
    placingway_code: 'EA44',
    placingway_name: 'Электронный аукцион',
    
    etp_code: 'RTS',
    etp_name: 'РТС-тендер',
    etp_url: 'https://www.rts-tender.ru',
    
    startdt: '2025-10-20',
    enddt: '2025-11-15',
    biddingdt: '2025-11-18',
    summarizingdt: '2025-11-22',
    
    maxprice: 12500000,
    currency_code: 'RUB',
    currency_name: 'Российский рубль',
    
    part: 5.0,
    procedureinfo: 'Обеспечение заявки вносится на счет электронной площадки',
    
    okpd2info: '30.02.30.000 - Вычислительная техника и оборудование',
    kvr_code: '244',
    kvr_info: 'Прочая закупка товаров, работ и услуг',
    
    contract_enddate: '2025-12-31',
    finance_total: 12500000,
    
    countrycode: 'RU',
    countryfullname: 'Российская Федерация',
    garaddress: '77000000000000000000000',
    deliveryplace: 'г. Москва, ул. Тверская, д. 11',
    
    servicerequirement: 'Гарантийное обслуживание 36 месяцев',
    warrantytermdt: '36 месяцев',
    addinfo: 'Поставка осуществляется партиями в течение 30 календарных дней с момента заключения контракта',
    
    regnum: '7710568760',
    consregistrynum: '00373100001800000001',
    fullname: 'Министерство образования и науки Российской Федерации',
    shortname: 'Минобрнауки России',
    postaddress: '125993, г. Москва, ул. Тверская, д. 11',
    factaddress: '125993, г. Москва, ул. Тверская, д. 11',
    inn: '7710568760',
    kpp: '771001001',
    responsiblerole: 'Заказчик',
    
    person_lastname: 'Иванова',
    person_firstname: 'Мария',
    person_middlename: 'Петровна',
    contactemail: 'zakupki@minobr.gov.ru',
    contactphone: '+7 (495) 123-45-67',
    contactfax: '+7 (495) 123-45-68',
    
    items: [
      {
        id: 1,
        object_number: '0373100001823000001',
        item_name: 'Персональный компьютер',
        item_code: '001',
        okpdcode: '30.02.30.100',
        okpdname: 'Компьютеры персональные',
        quantity_name: 'штук',
        price_for_one: 65000,
        quantity_value: 150,
        total_sum: 9750000,
      },
      {
        id: 2,
        object_number: '0373100001823000001',
        item_name: 'Ноутбук',
        item_code: '002',
        okpdcode: '30.02.30.200',
        okpdname: 'Компьютеры портативные',
        quantity_name: 'штук',
        price_for_one: 45000,
        quantity_value: 50,
        total_sum: 2250000,
      },
      {
        id: 3,
        object_number: '0373100001823000001',
        item_name: 'Монитор LCD 24"',
        item_code: '003',
        okpdcode: '30.02.30.300',
        okpdname: 'Мониторы и проекторы компьютерные',
        quantity_name: 'штук',
        price_for_one: 18000,
        quantity_value: 150,
        total_sum: 2700000,
      },
    ],
    
    attachments: [
      {
        id: 1,
        object_number: '0373100001823000001',
        published_content_id: 'pc_001',
        file_name: 'Техническое задание.pdf',
        doc_kind_code: 'TZ',
        doc_kind_name: 'Техническое задание',
        file_size: 2516582,
        doc_date: '2025-10-20',
        url: '#',
      },
      {
        id: 2,
        object_number: '0373100001823000001',
        published_content_id: 'pc_002',
        file_name: 'Проект контракта.docx',
        doc_kind_code: 'PK',
        doc_kind_name: 'Проект контракта',
        file_size: 1887436,
        doc_date: '2025-10-20',
        url: '#',
      },
      {
        id: 3,
        object_number: '0373100001823000001',
        published_content_id: 'pc_003',
        file_name: 'Спецификация оборудования.xlsx',
        doc_kind_code: 'SP',
        doc_kind_name: 'Спецификация',
        file_size: 876544,
        doc_date: '2025-10-20',
        url: '#',
      },
    ],
  },
  {
    id: 2,
    object_number: '0373100001823000002',
    zakon: '44-ФЗ',
    etap_zakupki: 'Прием заявок',
    
    object_info: 'Строительство дорожного покрытия в микрорайоне',
    placingway_code: 'OK',
    placingway_name: 'Открытый конкурс',
    
    etp_code: 'SBER',
    etp_name: 'Сбербанк-АСТ',
    etp_url: 'https://www.sberbank-ast.ru',
    
    startdt: '2025-10-22',
    enddt: '2025-11-20',
    biddingdt: '2025-11-25',
    summarizingdt: '2025-11-28',
    
    maxprice: 45000000,
    currency_code: 'RUB',
    currency_name: 'Российский рубль',
    
    part: 5.0,
    
    okpd2info: '45.23.31.000 - Строительство автомобильных дорог и автомагистралей',
    kvr_code: '243',
    kvr_info: 'Закупка работ и услуг в целях капитального ремонта',
    
    contract_enddate: '2026-06-30',
    finance_total: 45000000,
    
    countrycode: 'RU',
    countryfullname: 'Российская Федерация',
    deliveryplace: 'Московская область, г. Подольск, микрорайон Кузнечики',
    
    addinfo: 'Работы выполняются в соответствии с проектной документацией',
    
    fullname: 'Департамент транспорта и развития дорожно-транспортной инфраструктуры города Москвы',
    shortname: 'Департамент транспорта',
    inn: '7729314980',
    kpp: '772901001',
    
    person_lastname: 'Петров',
    person_firstname: 'Алексей',
    person_middlename: 'Сергеевич',
    contactemail: 'zakupki@dt.mos.ru',
    contactphone: '+7 (495) 987-65-43',
    
    items: [
      {
        id: 4,
        object_number: '0373100001823000002',
        item_name: 'Устройство асфальтобетонного покрытия',
        okpdcode: '45.23.31.110',
        okpdname: 'Работы по устройству покрытий',
        quantity_name: 'кв. м',
        price_for_one: 4500,
        quantity_value: 10000,
        total_sum: 45000000,
      },
    ],
    
    attachments: [
      {
        id: 4,
        object_number: '0373100001823000002',
        file_name: 'Проектная документация.pdf',
        doc_kind_name: 'Проектная документация',
        file_size: 15728640,
        doc_date: '2025-10-22',
        url: '#',
      },
    ],
  },
  {
    id: 3,
    object_number: '0373100001823000003',
    zakon: '44-ФЗ',
    etap_zakupki: 'Прием заявок',
    
    object_info: 'Разработка и внедрение программного обеспечения для автоматизации учета',
    placingway_code: 'EA44',
    placingway_name: 'Электронный аукцион',
    
    etp_code: 'RTS',
    etp_name: 'РТС-тендер',
    
    startdt: '2025-10-18',
    enddt: '2025-11-10',
    biddingdt: '2025-11-13',
    
    maxprice: 8200000,
    currency_code: 'RUB',
    currency_name: 'Российский рубль',
    
    okpd2info: '62.01.12.000 - Услуги по разработке программного обеспечения',
    
    contract_enddate: '2026-03-31',
    finance_total: 8200000,
    
    countrycode: 'RU',
    deliveryplace: 'г. Москва',
    
    fullname: 'Администрация города Москвы',
    shortname: 'Администрация Москвы',
    inn: '7701000001',
    kpp: '770101001',
    
    contactemail: 'it@mos.ru',
    contactphone: '+7 (495) 777-77-77',
    
    items: [
      {
        id: 5,
        object_number: '0373100001823000003',
        item_name: 'Разработка ПО',
        okpdcode: '62.01.12.000',
        quantity_name: 'услуга',
        quantity_value: 1,
        total_sum: 8200000,
      },
    ],
  },
  {
    id: 4,
    object_number: '0373100001823000004',
    zakon: '44-ФЗ',
    etap_zakupki: 'Работа комиссии',
    
    object_info: 'Поставка медицинского оборудования',
    placingway_code: 'ZK',
    placingway_name: 'Запрос котировок',
    
    startdt: '2025-10-15',
    enddt: '2025-11-05',
    
    maxprice: 15700000,
    currency_code: 'RUB',
    
    okpd2info: '33.10.11.000 - Аппаратура медицинская',
    
    deliveryplace: 'г. Санкт-Петербург',
    
    fullname: 'ГБУЗ «Городская больница № 15»',
    shortname: 'ГБ № 15',
    inn: '7800000015',
    kpp: '780001001',
    
    items: [
      {
        id: 6,
        object_number: '0373100001823000004',
        item_name: 'Аппарат УЗИ',
        okpdcode: '33.10.11.100',
        quantity_name: 'штук',
        quantity_value: 5,
        price_for_one: 3140000,
        total_sum: 15700000,
      },
    ],
  },
  {
    id: 5,
    object_number: '0373100001823000005',
    zakon: '223-ФЗ',
    etap_zakupki: 'Прием заявок',
    
    object_info: 'Ремонт и обслуживание систем вентиляции',
    placingway_code: 'EA223',
    placingway_name: 'Электронный аукцион',
    
    startdt: '2025-10-25',
    enddt: '2025-11-25',
    
    maxprice: 3400000,
    currency_code: 'RUB',
    
    okpd2info: '43.22.11.000 - Работы по монтажу систем отопления, вентиляции и кондиционирования воздуха',
    
    deliveryplace: 'Республика Татарстан, г. Казань',
    
    fullname: 'МУП «Жилищное хозяйство»',
    shortname: 'МУП ЖХ',
    inn: '1600000001',
    kpp: '160001001',
    
    items: [
      {
        id: 7,
        object_number: '0373100001823000005',
        item_name: 'Ремонт системы вентиляции',
        okpdcode: '43.22.11.000',
        quantity_name: 'услуга',
        quantity_value: 1,
        total_sum: 3400000,
      },
    ],
  },
];
