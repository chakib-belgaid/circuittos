import { TestBed, inject } from '@angular/core/testing';

import { StoresService1 } from './stores.service';

describe('StoresService1', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [StoresService1]
    });
  });

  it('should be created', inject([StoresService1], (service: StoresService1) => {
    expect(service).toBeTruthy();
  }));
});
