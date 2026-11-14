import * as d3 from 'https://cdn.jsdelivr.net/npm/d3@7/+esm';

mapboxgl.accessToken = 'pk.eyJ1IjoiaGFsMTUwIiwiYSI6ImNtd2cxcDB3bTBjd20zMG83cWZ2Y2hieTQifQ.DKXfYv4r2L6iYHE2e-l16g';
const MAP_STYLE = 'mapbox://styles/hal150/cmwg2erbd00b901sg19rq3nnn';

const STATIONS_URL = 'https://dsc106.com/labs/lab07/data/bluebikes-stations.json';
const TRIPS_URL = 'https://dsc106.com/labs/lab07/data/bluebikes-traffic-2024-03.csv';

const BIKE_LANE_STYLE = {
	'line-color': '#32D400',
	'line-width': 3,
	'line-opacity': 0.65,
};

const map = new mapboxgl.Map({
	container: 'map',
	style: MAP_STYLE,
	center: [-71.09415, 42.36027],
	zoom: 12,
	minZoom: 5,
	maxZoom: 18,
});

map.addControl(new mapboxgl.NavigationControl(), 'top-left');

const status = document.getElementById('status');
const timeSlider = document.getElementById('time-slider');
const selectedTime = document.getElementById('selected-time');
const anyTimeLabel = document.getElementById('any-time');
const svg = d3.select('#map').select('svg');

const tooltip = d3.select('#map')
	.append('div')
	.attr('class', 'station-tooltip')
	.attr('role', 'tooltip')
	.attr('aria-hidden', 'true');

function positionTooltip(event) {
	const bounds = document.getElementById('map').getBoundingClientRect();
	const margin = 14;
	const tooltipWidth = tooltip.node().offsetWidth;
	const tooltipHeight = tooltip.node().offsetHeight;
	const x = Math.min(event.clientX - bounds.left + margin, bounds.width - tooltipWidth - 8);
	const y = Math.max(8, event.clientY - bounds.top - tooltipHeight - margin);
	tooltip.style('left', `${Math.max(8, x)}px`).style('top', `${y}px`);
}

function showTooltip(event, d) {
	tooltip
		.style('display', 'block')
		.attr('aria-hidden', 'false')
		.text('');
	tooltip.append('strong').text(d.name);
	tooltip.append('div').text(`${d.totalTraffic.toLocaleString()} total trips`);
	tooltip.append('div').text(`${d.departures.toLocaleString()} departures`);
	tooltip.append('div').text(`${d.arrivals.toLocaleString()} arrivals`);
	positionTooltip(event);
}

function hideTooltip() {
	tooltip.style('display', 'none').attr('aria-hidden', 'true');
}


const departuresByMinute = Array.from({ length: 1440 }, () => []);
const arrivalsByMinute = Array.from({ length: 1440 }, () => []);
let stationCircles;
let stations = [];

function getCoords(station) {
	const { x, y } = map.project([+station.lon, +station.lat]);
	return { cx: x, cy: y };
}

function updatePositions() {
	if (!stationCircles) return;
	stationCircles
		.attr('cx', (d) => getCoords(d).cx)
		.attr('cy', (d) => getCoords(d).cy);
}

function formatTime(minutes) {
	const hours = Math.floor(minutes / 60);
	const mins = minutes % 60;
	const hour12 = hours % 12 || 12;
	return `${hour12}:${String(mins).padStart(2, '0')} ${hours < 12 ? 'AM' : 'PM'}`;
}

// Parse the clock time directly to avoid time-zone shifts on users' computers.
function minutesFromTimestamp(timestamp) {
	const time = String(timestamp).match(/(?:T|\s)(\d{2}):(\d{2})/);
	if (!time) return null;
	return Number(time[1]) * 60 + Number(time[2]);
}

// For -1, include the entire day. Otherwise include +/- 60 minutes,
// correctly wrapping around midnight (e.g. 11:45 PM to 12:45 AM).
function filterByMinute(buckets, minute) {
	if (minute === -1) return buckets.flat();
	const relevant = [];
	for (let offset = -60; offset <= 60; offset++) {
		const index = (minute + offset + 1440) % 1440;
		relevant.push(...buckets[index]);
	}
	return relevant;
}

function computeStationTraffic(allStations, timeFilter = -1) {
	const departures = d3.rollup(
		filterByMinute(departuresByMinute, timeFilter),
		(v) => v.length,
		(d) => d.start_station_id,
	);
	const arrivals = d3.rollup(
		filterByMinute(arrivalsByMinute, timeFilter),
		(v) => v.length,
		(d) => d.end_station_id,
	);

	return allStations.map((station) => {
		const id = station.short_name;
		return {
			...station,
			arrivals: arrivals.get(id) ?? 0,
			departures: departures.get(id) ?? 0,
			totalTraffic: (arrivals.get(id) ?? 0) + (departures.get(id) ?? 0),
		};
	});
}

const stationFlow = d3.scaleQuantize().domain([0, 1]).range([0, 0.5, 1]);
let radiusScale;

function updateScatterPlot(timeFilter) {
	const filteredStations = computeStationTraffic(stations, timeFilter);
	const maxTraffic = d3.max(filteredStations, (d) => d.totalTraffic) || 1;
	radiusScale.domain([0, maxTraffic]);
	radiusScale.range(timeFilter === -1 ? [0, 25] : [3, 50]);

	stationCircles = svg
		.selectAll('circle')
		.data(filteredStations, (d) => d.short_name)
		.join('circle')
		.attr('r', (d) => d.totalTraffic === 0 ? 0 : radiusScale(d.totalTraffic))
		.style('--departure-ratio', (d) =>
			d.totalTraffic ? stationFlow(d.departures / d.totalTraffic) : 0.5,
		);

	// Interactive tooltip. On small markers, the pointer cursor helps show they're hoverable.
	stationCircles
		.on('mouseenter', showTooltip)
		.on('mousemove', (event, d) => {
			if (tooltip.style('display') === 'none') showTooltip(event, d);
			else positionTooltip(event);
		})
		.on('mouseleave', hideTooltip);

	hideTooltip();
	updatePositions();
}

function updateTimeDisplay() {
	const timeFilter = Number(timeSlider.value);
	if (timeFilter === -1) {
		selectedTime.textContent = '';
		anyTimeLabel.style.display = 'block';
	} else {
		selectedTime.textContent = formatTime(timeFilter);
		anyTimeLabel.style.display = 'none';
	}
	updateScatterPlot(timeFilter);
}

map.on('error', (event) => {
	console.error('Mapbox error:', event.error || event);
	status.textContent = 'Map error: check your published style URL, token permissions, and browser console.';
});

map.on('load', async () => {
	// and Cambridge bicycle paths.
	map.addSource('boston_route', {
		type: 'geojson',
		data: 'https://bostonopendata-boston.opendata.arcgis.com/datasets/boston::existing-bike-network-2022.geojson',
	});
	map.addLayer({
		id: 'bike-lanes',
		type: 'line',
		source: 'boston_route',
		paint: BIKE_LANE_STYLE,
	});

	map.addSource('cambridge_route', {
		type: 'geojson',
		data: 'https://raw.githubusercontent.com/cambridgegis/cambridgegis_data/main/Recreation/Bike_Facilities/RECREATION_BikeFacilities.geojson',
	});
	map.addLayer({
		id: 'cambridge-bike-lanes',
		type: 'line',
		source: 'cambridge_route',
		paint: BIKE_LANE_STYLE,
	});

	try {
		status.textContent = 'Loading Bluebikes data (March 2024)…';
		const [jsonData] = await Promise.all([
			d3.json(STATIONS_URL),
			d3.csv(TRIPS_URL, (trip) => {
				const start = minutesFromTimestamp(trip.started_at);
				const end = minutesFromTimestamp(trip.ended_at);
				if (start !== null && trip.start_station_id) departuresByMinute[start].push(trip);
				if (end !== null && trip.end_station_id) arrivalsByMinute[end].push(trip);
				return null; // Buckets retain the rows; no need for a second copy.
			}),
		]);

		stations = jsonData.data.stations.filter((d) => Number.isFinite(+d.lon) && Number.isFinite(+d.lat));
		radiusScale = d3.scaleSqrt();
		updateScatterPlot(-1);
		map.on('move', updatePositions);
		map.on('resize', updatePositions);
		timeSlider.disabled = false;
		timeSlider.addEventListener('input', updateTimeDisplay);
		status.textContent = `${stations.length} stations loaded • March 2024 traffic`;
	} catch (error) {
		console.error('Data loading error:', error);
		status.textContent = 'Could not load station/trip data. Open F12 → Console to inspect the error.';
	}
});
