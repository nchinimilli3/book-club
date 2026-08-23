export type Book = { id:string; title:string; author:string; cover:string; year?:number; pages?:number; genres?:string[]; description?:string; readingHours?:number };
export type Member = { id:string; name:string; handle:string; avatar:string; chapter:number; color:string };
export type Club = { id:string; name:string; mark:string; tone:'pink'|'butter'|'olive'|'lavender'|'sky'|'wine'; bookId?:string; status:string; members:string[]; phase:'setup'|'choosing'|'acquiring'|'reading'|'planning'|'meeting'|'rating'|'archived'; meeting?:string; finishDate?:string; inviteCode:string };

export const books: Book[] = [
  {id:'rebecca', title:'Rebecca', author:'Daphne du Maurier', cover:'https://covers.openlibrary.org/b/isbn/9780380730407-L.jpg', year:1938, pages:449, genres:['Gothic','Mystery'], readingHours:9, description:'A young woman enters Manderley and finds herself living in the shadow of Maxim de Winter’s first wife.'},
  {id:'secret-history', title:'The Secret History', author:'Donna Tartt', cover:'https://covers.openlibrary.org/b/isbn/9781400031702-L.jpg', year:1992, pages:559, genres:['Literary','Mystery'], readingHours:12, description:'A group of classics students become entangled in beauty, obsession, and violence.'},
  {id:'splendid-suns', title:'A Thousand Splendid Suns', author:'Khaled Hosseini', cover:'https://covers.openlibrary.org/b/isbn/9781594489501-L.jpg', year:2007, pages:372, genres:['Historical','Literary'], readingHours:8, description:'Two Afghan women form an extraordinary bond across decades of upheaval.'},
  {id:'gone-girl', title:'Gone Girl', author:'Gillian Flynn', cover:'https://covers.openlibrary.org/b/isbn/9780307588371-L.jpg', year:2012, pages:432, genres:['Thriller'], readingHours:9, description:'A marriage becomes a media spectacle after a wife disappears.'},
  {id:'sharp-objects', title:'Sharp Objects', author:'Gillian Flynn', cover:'https://covers.openlibrary.org/b/isbn/9780307341556-L.jpg', year:2006, pages:254, genres:['Thriller'], readingHours:5, description:'A reporter returns home to investigate a series of murders and confront her own past.'},
  {id:'bell-jar', title:'The Bell Jar', author:'Sylvia Plath', cover:'https://covers.openlibrary.org/b/isbn/9780060837020-L.jpg', year:1963, pages:244, genres:['Classic'], readingHours:5, description:'A sharp, intimate novel about ambition, identity, and confinement.'},
  {id:'pride', title:'Pride and Prejudice', author:'Jane Austen', cover:'https://covers.openlibrary.org/b/isbn/9780141439518-L.jpg', year:1813, pages:480, genres:['Classic','Romance'], readingHours:10, description:'Elizabeth Bennet and Mr. Darcy collide over class, pride, and first impressions.'},
  {id:'gatsby', title:'The Great Gatsby', author:'F. Scott Fitzgerald', cover:'https://covers.openlibrary.org/b/isbn/9780743273565-L.jpg', year:1925, pages:180, genres:['Classic'], readingHours:4, description:'A glittering, tragic portrait of desire and reinvention in the Jazz Age.'},
  {id:'1984', title:'1984', author:'George Orwell', cover:'https://covers.openlibrary.org/b/isbn/9780451524935-L.jpg', year:1949, pages:328, genres:['Classic','Dystopian'], readingHours:7, description:'A totalitarian state controls truth, memory, and private life.'},
  {id:'mockingbird', title:'To Kill a Mockingbird', author:'Harper Lee', cover:'https://covers.openlibrary.org/b/isbn/9780061120084-L.jpg', year:1960, pages:336, genres:['Classic'], readingHours:7, description:'A child observes injustice and moral courage in a Southern town.'},
];

export const members: Member[] = [
  {id:'neha', name:'Neha', handle:'@neha.reads', avatar:'https://i.pravatar.cc/160?img=47', chapter:12, color:'#f35379'},
  {id:'maya', name:'Maya', handle:'@maya.reads', avatar:'https://i.pravatar.cc/160?img=45', chapter:9, color:'#7d8c4a'},
  {id:'alex', name:'Alex', handle:'@alexreads', avatar:'https://i.pravatar.cc/160?img=12', chapter:14, color:'#c79a57'},
  {id:'sam', name:'Sam', handle:'@sam.books', avatar:'https://i.pravatar.cc/160?img=5', chapter:8, color:'#8d6a8f'},
  {id:'priya', name:'Priya', handle:'@priya.pages', avatar:'https://i.pravatar.cc/160?img=32', chapter:11, color:'#5f8c84'},
];

export const clubs: Club[] = [
 {id:'sunday',name:'Sunday Readers',mark:'✣',tone:'pink',bookId:'rebecca',status:'Reading · Ch. 12',members:['neha','maya','alex','sam','priya'],phase:'reading',meeting:'Sunday, Sep 22 · 8:00 PM',finishDate:'Oct 20',inviteCode:'SUNDAY7'},
 {id:'college',name:'College Friends',mark:'♥',tone:'butter',bookId:'splendid-suns',status:'Meeting tonight',members:['neha','maya','alex','sam','priya'],phase:'meeting',meeting:'Tonight · 8:30 PM',finishDate:'Sep 18',inviteCode:'COLLEGE5'},
 {id:'classics',name:'Classics Club',mark:'✦',tone:'olive',bookId:'gatsby',status:'Voting ends tomorrow',members:['neha','maya','alex','sam'],phase:'choosing',inviteCode:'CLASSIC4'},
 {id:'summer',name:'Summer Book Club',mark:'☻',tone:'lavender',bookId:'secret-history',status:'4 / 5 have a copy',members:['neha','maya','alex','sam','priya'],phase:'acquiring',meeting:'Oct 25 · 8:00 PM',finishDate:'Oct 20',inviteCode:'SUMMER5'},
];

export const thoughts = [
  {id:'t1', user:'maya', chapter:9, text:'I genuinely do not trust Mrs. Danvers for one second.', reactions:{'!!!':4,'same':2}, replies:3, ago:'10m'},
  {id:'t2', user:'alex', chapter:13, text:'The atmosphere in this chapter is actually unreal.', reactions:{'!!!':6,'💀':1}, replies:1, ago:'2h'},
  {id:'t3', user:'priya', chapter:14, text:'I have a theory but I am locking it until everyone catches up.', reactions:{'👀':3}, replies:0, ago:'3h'},
];

export const contextItems = [
  {type:'Before You Read', kicker:'SETTING · PERIOD · TONE', title:'What to know before you keep reading', short:'Rebecca is a Gothic novel set largely around Manderley, an English country estate. Its unnamed narrator enters a world shaped by class, memory, and the lingering presence of Maxim de Winter’s first wife.', medium:'Published in 1938, Rebecca uses classic Gothic machinery—an imposing house, psychological unease, secrecy, and an incomplete point of view. That context helps explain why Manderley feels like a character of its own and why the narrator’s uncertainty matters.', deep:'Rebecca sits between Gothic romance, psychological suspense, and social observation. Manderley becomes a symbol of status, inheritance, memory, and comparison. The narrator’s anonymity is deliberate: it heightens her displacement and makes the reader experience the household through her insecurity. The novel’s 1938 publication date also matters because the country-estate world it depicts is already under social pressure.'},
  {type:'Places', kicker:'PLACE', title:'Cornwall & Manderley', short:'Du Maurier’s Cornwall shaped the novel’s sense of isolation, coastline, weather, and estate life.', medium:'Cornwall’s dramatic coast and secluded estates recur throughout du Maurier’s fiction. Manderley is fictional, but its emotional geography draws on places she knew closely, especially the sense of a house hidden inside a landscape.', deep:'Du Maurier moved to Cornwall in the 1920s and later leased Menabilly, a secluded estate that strongly influenced her imagination. In Rebecca, roads, coastline, gardens, rooms, and thresholds are not decorative scenery; they control who feels at home, who belongs, and what can be remembered or hidden.'},
  {type:'Author', kicker:'AUTHOR', title:'Daphne du Maurier', short:'An English novelist and playwright best known for Rebecca, Jamaica Inn, and stories including The Birds.', medium:'Born in 1907 into a theatrical and literary family, du Maurier became known for suspenseful fiction blending romance, psychological tension, and an unusually strong sense of place. Several works later became major screen adaptations.', deep:'Du Maurier resisted simple genre labels even while becoming a huge popular success. Her fiction repeatedly explores unstable identity, obsession, doubles, power, social roles, and private desire. Rebecca became the defining novel of her career and has remained continuously in print.'},
];

export const goodreadsRead = [books[0],books[1],books[3],books[4],books[5],books[6],books[7],books[8],books[9]];
