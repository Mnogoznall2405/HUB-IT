import { getTasksPage } from '../api/taskApi';
import { writeNativeCollectionSnapshot } from '../cache/nativeSnapshotCache';
import { recordNativeOfflineCoverageSuccess, recordNativeOfflineCoverageFailure } from './nativeOfflineCoverage';
import { prepareNativeOfflineData, type PreparationOptions } from './nativeOfflinePreparation';
let mockGeneration = 0;
jest.mock('../auth/tokenStore', () => ({ ...jest.requireActual('../auth/tokenStore'), getSessionGeneration: () => mockGeneration }));
jest.mock('../api/taskApi', () => ({ getTasksPage: jest.fn() }));
jest.mock('../cache/nativeSnapshotCache', () => ({ writeNativeCollectionSnapshot: jest.fn(async () => true) }));
jest.mock('./nativeOfflineCoverage', () => ({ recordNativeOfflineCoverageSuccess: jest.fn(async () => true), recordNativeOfflineCoverageFailure: jest.fn(async () => true) }));
jest.mock('../diagnostics/diagnostics', () => ({ recordSnapshotFailure: jest.fn(async () => undefined) }));
const options: PreparationOptions = { userId: 17, isAdmin: false, dashboard:false, feed:false,tasks:true,mail:false,docflow:false,addressBook:false,database:false,myFiles:false,companyStructure:false };
const api = jest.mocked(getTasksPage);
const write = jest.mocked(writeNativeCollectionSnapshot);
function pages(total: number, failAt = -1) {
 api.mockImplementation(async (request) => {
  const offset = request?.offset || 0;
  if(offset === failAt) throw new Error('network unavailable');
  return { items:Array.from({length:Math.min(200,total-offset)},(_,i)=>({id:String(offset+i+1)})),offset,limit:200,total } as Awaited<ReturnType<typeof getTasksPage>>;
 });
}
function lengths() { return write.mock.calls.map(call => (call[3] as {page:{items:unknown[]}}).page.items.length); }
beforeEach(()=>{ jest.clearAllMocks(); mockGeneration++; write.mockResolvedValue(true); });
it('writes geometric checkpoints and the last page',async()=>{
 pages(2000); await prepareNativeOfflineData(options);
 expect(lengths()).toEqual([200,400,800,1600,2000]);
 expect(api).toHaveBeenCalledTimes(10);
 expect(recordNativeOfflineCoverageSuccess).toHaveBeenCalledWith(17,'tasks',expect.objectContaining({loaded:2000,status:'complete'}));
});
it('flushes every successfully fetched page before reporting network failure',async()=>{
 pages(2000,600); const result=await prepareNativeOfflineData(options);
 expect(lengths()).toEqual([200,400,600]);
 expect(result.failedModules).toHaveLength(1);
 expect(recordNativeOfflineCoverageFailure).toHaveBeenCalled();
});
it('reports only persisted coverage if a checkpoint cannot be stored',async()=>{
 pages(2000); write.mockResolvedValueOnce(true).mockResolvedValueOnce(true).mockResolvedValueOnce(false);
 await prepareNativeOfflineData(options);
 expect(lengths()).toEqual([200,400,800]);
 expect(recordNativeOfflineCoverageSuccess).toHaveBeenCalledWith(17,'tasks',expect.objectContaining({loaded:400,status:'partial'}));
});
it('retains initial storage failure semantics',async()=>{
 pages(1000); write.mockResolvedValueOnce(false);
 const result=await prepareNativeOfflineData(options);
 expect(result.failedModules).toHaveLength(1); expect(api).toHaveBeenCalledTimes(1);
});
it('shares concurrent identical preparations but preserves caller progress',async()=>{
 pages(1000); const a=jest.fn(),b=jest.fn();
 await Promise.all([prepareNativeOfflineData(options,a),prepareNativeOfflineData(options,b)]);
 expect(api).toHaveBeenCalledTimes(5); expect(lengths()).toEqual([200,400,800,1000]);
 expect(a).toHaveBeenLastCalledWith(expect.objectContaining({status:'completed'}));
 expect(b).toHaveBeenLastCalledWith(expect.objectContaining({status:'completed'}));
});
it('does not share preparations with different access scopes',async()=>{
 pages(200); await Promise.all([prepareNativeOfflineData(options),prepareNativeOfflineData({...options,isAdmin:true})]);
 expect(api).toHaveBeenCalledTimes(2);
});
it('does not write or fetch later pages after session invalidation',async()=>{
 pages(1000); const implementation=api.getMockImplementation()!;
 api.mockImplementationOnce(async request=>{const page=await implementation(request); mockGeneration++; return page;});
 const result=await prepareNativeOfflineData(options);
 expect(write).not.toHaveBeenCalled(); expect(api).toHaveBeenCalledTimes(1);
 expect(recordNativeOfflineCoverageFailure).not.toHaveBeenCalled(); expect(recordNativeOfflineCoverageSuccess).not.toHaveBeenCalled();
 expect(result.failedModules).toHaveLength(1);
});
