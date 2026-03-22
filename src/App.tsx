import { BrowserRouter, Routes, Route } from 'react-router-dom';
import Home from './Home';
import Design1 from './designs/design1';
import Design2 from './designs/design2';
import Design3 from './designs/design3';
import Design4 from './designs/design4';
import Design5 from './designs/design5';
import Design6 from './designs/design6';
import Design7 from './designs/design7';
import Design8 from './designs/design8';
import Design9 from './designs/design9';
import Design10 from './designs/design10';

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/1" element={<Design1 />} />
        <Route path="/2" element={<Design2 />} />
        <Route path="/3" element={<Design3 />} />
        <Route path="/4" element={<Design4 />} />
        <Route path="/5" element={<Design5 />} />
        <Route path="/6" element={<Design6 />} />
        <Route path="/7" element={<Design7 />} />
        <Route path="/8" element={<Design8 />} />
        <Route path="/9" element={<Design9 />} />
        <Route path="/10" element={<Design10 />} />
      </Routes>
    </BrowserRouter>
  );
}
