import { readFile } from "fs/promises";
import { parse } from "csv-parse/sync";

const filePaths = {
    // Caruna export format
    usage: "sahko.csv",
    // https://pakastin.fi/hinnat/
    spotFiles: [
        "prices/2019.json",
        "prices/2020.json",
        "prices/prices.json"
    ]
};

const parseDate = (inputDate) => {
    // inputDate, e.g. "1.1.2019 00:00"
    const [date, time] = inputDate.split(" ");
    const [day, month, year] = date.split(".");

    // Assumed timezone depends on local time.. DST?
    const dateString = `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}T${time}:00`;

    return new Date(dateString);
}

const parseUsageDate = (usageInputDate) => {
    // inputDate, e.g. "tiistai 1.1.2019 00:00"
    const [_, ...inputDate] = usageInputDate.split(" ")

    return parseDate(inputDate.join(" "));
}

const parseUsage = (inputUsage) => {
    // inputUsage "2,69" or "Ei kulutustietoja tällä ajanjaksolla."
    if (inputUsage === "Ei kulutustietoja tällä ajanjaksolla.") {
        return 0;
    }

    const usage = Number.parseFloat(inputUsage.replace(",", "."));

    return Number.isNaN(usage) ? 0 : usage;
}

const parseUsageFile = async (path=filePaths.usage) => {
    console.log(`Loading usage from ${path}`);

    const file = await readFile(path);

    // {date: string; usage: string}[]
    const rows = parse(file, {
        bom: true,
        columns: ["date", "usage"],
        delimiter: ";",
        fromLine: 2
    });

    console.log(`Parsed ${rows.length} usage rows`);

    // date as Date, usage as kWh
    return rows.map(({ date, usage }) => ({
        date: parseUsageDate(date),
        usage: parseUsage(usage)
    }));
};

const parseSpotFile = async (paths=filePaths.spotFiles) => {
    const spotPrices = {};
    let rowCount = 0;

    // VAT 24%
    const vat = 1.24

    for (const path of paths) {
        console.log(`Loading spot prices from ${path}`);
        const file = await readFile(path);

        // {prices: {date:"2019-12-31T23:00:00.000Z",value:28.78}[]}
        const jsonFile = JSON.parse(file);

        // Some files have "prices" property, some don't
        const prices = jsonFile.prices ? jsonFile.prices : jsonFile;

        prices.forEach(({ date, value }) => {
            spotPrices[date] = value / 10 * vat;
        });

        rowCount += prices.length;
    }

    console.log(`Parsed ${rowCount} spot price rows`);

    return spotPrices;
};

const isDayPrice = date => {
    const hours = date.getHours();

    return hours >= 7 && hours < 22;
};

const getSpotContract = (spotPrices) => ({ date, usage }) => {
    const price = spotPrices[date.toISOString()];

    if (price === undefined) {
        throw new Error(`Spot price missing for ${date}`)
    }

    return usage * price;
};
const getConstantContract = (rate) => ({ date, usage }) => usage * rate;
const getNightContract = (dayRate, nightRate) => ({ date, usage }) => usage * (isDayPrice(date) ? dayRate : nightRate);

const getRowsBetween = (rows, from, to) => rows.filter(row => row.date >= from && row.date <= to);

const getCost = async (from, to, getPrice) => {
    console.log(`Calculating cost from ${from} to ${to}`);

    const allRows = await parseUsageFile();
    const rows = getRowsBetween(allRows, from, to);
    const { cost, usage } = rows.reduce((total, row) => {
        const price = getPrice(row);

        return {
            cost: total.cost + price,
            usage: total.usage + row.usage
        }
    }, {
        cost: 0,
        usage: 0
    });

    console.log(`Total cost ${Math.round(cost*100)/10000}€, usage ${Math.round(usage)} kWh`);
};

await getCost(
    parseDate("31.7.2019 00:00"),
    parseDate("31.7.2021 23:00"),
    getNightContract(6, 5)
    // getSpotContract(await parseSpotFile())
);